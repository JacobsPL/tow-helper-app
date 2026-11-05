const MM_PER_INCH = 25.4;
const EPSILON = 1e-8;
const BASE_SIZES = [
    [20, 20], [25, 25], [30, 30], [40, 40], [50, 50],
    [25, 50], [30, 60], [40, 60], [40, 80], [50, 75], [50, 100],
    [60, 100], [100, 150]
];

export function createFormation({files, ranks, alive, baseWidth, baseDepth, missingFrom = "right"}) {
    if (!Number.isInteger(files) || files < 1 || files > 50
        || !Number.isInteger(ranks) || ranks < 1 || ranks > 50
        || !Number.isInteger(alive) || alive < 0 || alive > files * ranks
        || !Number.isFinite(baseWidth) || baseWidth <= 0
        || !Number.isFinite(baseDepth) || baseDepth <= 0) {
        throw new RangeError("Nieprawidłowe wymiary oddziału lub liczba modeli.");
    }
    const fullRanks = Math.floor(alive / files);
    const remainder = alive % files;
    return Array.from({length: files * ranks}, (_, index) => {
        const row = Math.floor(index / files);
        const column = index % files;
        const inLastRank = missingFrom === "left" ? column >= files - remainder : column < remainder;
        return {
            x: column * baseWidth, y: row * baseDepth,
            width: baseWidth, height: baseDepth,
            alive: row < fullRanks || (row === fullRanks && inLastRank)
        };
    });
}

export function classifyBase(base, circle) {
    if (!base.alive) return "removed";
    const nearestX = Math.max(base.x - circle.x, 0, circle.x - base.x - base.width);
    const nearestY = Math.max(base.y - circle.y, 0, circle.y - base.y - base.height);
    const radiusSquared = circle.radius ** 2;
    if (nearestX ** 2 + nearestY ** 2 >= radiusSquared - EPSILON) return "miss";
    const farthestX = Math.max(Math.abs(base.x - circle.x), Math.abs(base.x + base.width - circle.x));
    const farthestY = Math.max(Math.abs(base.y - circle.y), Math.abs(base.y + base.height - circle.y));
    return farthestX ** 2 + farthestY ** 2 <= radiusSquared + EPSILON ? "full" : "partial";
}

export function calculateHits(formation, circle) {
    const counts = {full: 0, partial: 0, miss: 0, removed: 0, total: 0};
    const hits = formation.map((base) => {
        const hit = classifyBase(base, circle);
        counts[hit] += 1;
        return hit;
    });
    counts.total = counts.full + counts.partial;
    return {...counts, hits};
}

function defaultState() {
    return {files: 5, ranks: 5, alive: 25, baseWidth: 25, baseDepth: 25, template: 3, missingFrom: "right", offsetX: 0, offsetY: 0};
}

function restoreState(storageKey) {
    try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey));
        const state = {...defaultState(), ...stored};
        createFormation(state);
        if (![3, 5].includes(state.template) || !["left", "right"].includes(state.missingFrom)
            || !Number.isFinite(state.offsetX) || !Number.isFinite(state.offsetY)
            || state.baseWidth > 300 || state.baseDepth > 300) return defaultState();
        return state;
    } catch {
        return defaultState();
    }
}

export function mountTemplateCalculator(root, sessionId) {
    const storageKey = `tow-helper-template:${sessionId}`;
    const state = restoreState(storageKey);
    const baseValue = `${state.baseWidth}x${state.baseDepth}`;
    const isPreset = BASE_SIZES.some(([width, depth]) => `${width}x${depth}` === baseValue);
    root.innerHTML = `
        <section class="form-panel template-controls" aria-label="Ustawienia oddziału i templatki">
            <div class="template-fields">
                <label>Files — kolumny<input type="number" data-template-field="files" min="1" max="50" step="1" value="${state.files}" inputmode="numeric"></label>
                <label>Ranks — szeregi<input type="number" data-template-field="ranks" min="1" max="50" step="1" value="${state.ranks}" inputmode="numeric"></label>
                <label>Żywe modele<input type="number" data-template-field="alive" min="0" max="${state.files * state.ranks}" step="1" value="${state.alive}" inputmode="numeric"></label>
                <label>Podstawka (mm)<select data-template-field="base">
                    ${BASE_SIZES.map(([width, depth]) => `<option value="${width}x${depth}" ${baseValue === `${width}x${depth}` ? "selected" : ""}>${width} × ${depth}</option>`).join("")}
                    <option value="custom" ${isPreset ? "" : "selected"}>Własna</option>
                </select></label>
                <label>Templatka<select data-template-field="template">
                    <option value="3" ${state.template === 3 ? "selected" : ""}>3″ — Small Blast</option>
                    <option value="5" ${state.template === 5 ? "selected" : ""}>5″ — Large Blast</option>
                </select></label>
                <label>Braki w niepełnym szeregu<select data-template-field="missingFrom">
                    <option value="right" ${state.missingFrom === "right" ? "selected" : ""}>Po prawej</option>
                    <option value="left" ${state.missingFrom === "left" ? "selected" : ""}>Po lewej</option>
                </select></label>
            </div>
            <div class="template-custom-base" ${isPreset ? "hidden" : ""}>
                <label>Szerokość podstawki (mm)<input type="number" data-template-field="baseWidth" min="1" max="300" step="1" value="${state.baseWidth}"></label>
                <label>Głębokość podstawki (mm)<input type="number" data-template-field="baseDepth" min="1" max="300" step="1" value="${state.baseDepth}"></label>
            </div>
            <p class="hint template-formation-note" data-template-note></p>
            <p class="notice error" data-template-error role="alert" hidden></p>
        </section>
        <section class="template-results" aria-label="Wynik trafień" aria-live="polite" aria-atomic="true">
            <div class="template-result full"><span>Full hits</span><strong data-template-count="full">0</strong><small>Cała podstawka pod templatką</small></div>
            <div class="template-result partial"><span>Partial hits</span><strong data-template-count="partial">0</strong><small>Podstawka częściowo przykryta</small></div>
            <div class="template-result total"><span>Razem trafionych</span><strong data-template-count="total">0</strong><small>Full + partial, tylko żywe modele</small></div>
        </section>
        <section class="form-panel template-diagram-panel" aria-label="Wizualizacja trafień">
            <div class="template-diagram-heading">
                <div><h2>Ustawienie templatki</h2><p class="hint">Przeciągnij koło lub kliknij miejsce na planszy. Strzałki przesuwają je o 1 mm, Shift + strzałka o 10 mm.</p></div>
                <button type="button" class="secondary" data-template-center>Wycentruj templatkę</button>
            </div>
            <svg class="template-diagram" data-template-diagram tabindex="0" role="img" aria-label="Oddział i przesuwana templatka. Brakujące modele oznaczono X."></svg>
            <div class="template-diagram-footer">
                <div class="template-legend" aria-label="Legenda">
                    <span><i class="full"></i>Full</span><span><i class="partial"></i>Partial</span><span><i class="miss"></i>Bez trafienia</span><span><b class="template-x">X</b>Brak modelu</span>
                </div>
                <div class="template-offsets">
                    <label>Przesunięcie X (″)<input type="number" data-template-field="offsetX" step="0.01" min="-100" max="100" value="${(state.offsetX / MM_PER_INCH).toFixed(2)}"></label>
                    <label>Przesunięcie Y (″)<input type="number" data-template-field="offsetY" step="0.01" min="-100" max="100" value="${(state.offsetY / MM_PER_INCH).toFixed(2)}"></label>
                </div>
            </div>
            <p class="hint template-measurements">3″ = 76,2 mm · 5″ = 127 mm. Modele zdejmuje się od ostatniego szeregu. X nie wliczają się do trafień.</p>
        </section>
    `;

    const svg = root.querySelector("[data-template-diagram]");
    const field = (name) => root.querySelector(`[data-template-field="${name}"]`);
    let formation = [];
    let rectangles = [];
    let templateCircle;
    let crosshair;
    let drag = null;
    let frame = 0;

    function save() {
        try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* The calculator also works without storage. */ }
    }

    function circle() {
        return {x: state.files * state.baseWidth / 2 + state.offsetX, y: state.ranks * state.baseDepth / 2 + state.offsetY, radius: state.template * MM_PER_INCH / 2};
    }

    function updateHits(syncOffsets = true) {
        const position = circle();
        const result = calculateHits(formation, position);
        rectangles.forEach((rect, index) => rect.setAttribute("class", `template-base ${result.hits[index]}`));
        templateCircle.setAttribute("cx", position.x);
        templateCircle.setAttribute("cy", position.y);
        templateCircle.setAttribute("r", position.radius);
        crosshair.setAttribute("transform", `translate(${position.x} ${position.y})`);
        for (const key of ["full", "partial", "total"]) {
            const count = root.querySelector(`[data-template-count="${key}"]`);
            if (count.textContent !== String(result[key])) count.textContent = result[key];
        }
        svg.setAttribute("aria-label", `Oddział: ${state.alive} żywych modeli. Templatka ${state.template} cale. Full: ${result.full}, partial: ${result.partial}, razem: ${result.total}. Braki oznaczono X.`);
        if (syncOffsets) {
            field("offsetX").value = (state.offsetX / MM_PER_INCH).toFixed(2);
            field("offsetY").value = (state.offsetY / MM_PER_INCH).toFixed(2);
        }
    }

    function rebuild() {
        formation = createFormation(state);
        const width = state.files * state.baseWidth;
        const height = state.ranks * state.baseDepth;
        const padding = Math.max(45, state.template * MM_PER_INCH / 2 + 15);
        svg.setAttribute("viewBox", `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`);
        svg.innerHTML = `
            <text x="${width / 2}" y="${-8}" text-anchor="middle" class="template-front-label" font-size="${Math.min(state.baseWidth * 0.45, 12)}">PRZÓD ODDZIAŁU</text>
            <g>${formation.map((base) => `<rect x="${base.x}" y="${base.y}" width="${base.width}" height="${base.height}" class="template-base"/>`).join("")}</g>
            <circle class="template-blast"/>
            <g class="template-crosshair"><path d="M -5 0 H 5 M 0 -5 V 5"/><circle r="1.5"/></g>
            <g class="template-missing" aria-hidden="true">${formation.filter((base) => !base.alive).map((base) => {
                const insetX = base.width * 0.25;
                const insetY = base.height * 0.25;
                return `<path d="M ${base.x + insetX} ${base.y + insetY} L ${base.x + base.width - insetX} ${base.y + base.height - insetY} M ${base.x + base.width - insetX} ${base.y + insetY} L ${base.x + insetX} ${base.y + base.height - insetY}"/>`;
            }).join("")}</g>
        `;
        rectangles = Array.from(svg.querySelectorAll(".template-base"));
        templateCircle = svg.querySelector(".template-blast");
        crosshair = svg.querySelector(".template-crosshair");
        const missing = state.files * state.ranks - state.alive;
        root.querySelector("[data-template-note]").textContent = `${state.alive} / ${state.files * state.ranks} modeli · ${missing} brakujących (X) · podstawki ${state.baseWidth} × ${state.baseDepth} mm`;
        updateHits();
        save();
    }

    function error(message = "") {
        const element = root.querySelector("[data-template-error]");
        element.hidden = !message;
        element.textContent = message;
    }

    function onInput(event) {
        const input = event.target;
        const name = input.dataset.templateField;
        if (!name || input.tagName === "SELECT") return;
        // Keep an unfinished value editable; never feed NaN or invalid dimensions into the diagram.
        if (input.value === "" || !Number.isFinite(input.valueAsNumber)) return;
        const value = input.valueAsNumber;
        const maximum = Number(input.max);
        if (value < Number(input.min) || value > maximum || (!name.startsWith("offset") && !Number.isInteger(value))) {
            error(`Pole „${input.parentElement.firstChild.textContent.trim()}” musi mieć wartość od ${input.min} do ${input.max}${name.startsWith("offset") ? "." : " (liczba całkowita)."}`);
            return;
        }
        error();
        if (name.startsWith("offset")) {
            state[name] = value * MM_PER_INCH;
            updateHits(false);
            save();
            return;
        }
        const wasFull = state.alive === state.files * state.ranks;
        state[name] = value;
        if (name === "files" || name === "ranks") {
            const capacity = state.files * state.ranks;
            state.alive = wasFull ? capacity : Math.min(state.alive, capacity);
            field("alive").max = capacity;
            field("alive").value = state.alive;
        }
        rebuild();
    }

    function onBlur(event) {
        const input = event.target;
        const name = input.dataset.templateField;
        if (name && input.tagName === "INPUT" && (input.value === "" || !input.validity.valid)) {
            input.value = name.startsWith("offset") ? (state[name] / MM_PER_INCH).toFixed(2) : state[name];
            error();
        }
    }

    function onChange(event) {
        const input = event.target;
        const name = input.dataset.templateField;
        if (input.tagName !== "SELECT") {
            onBlur(event);
            return;
        }
        if (name === "base") {
            const custom = input.value === "custom";
            root.querySelector(".template-custom-base").hidden = !custom;
            if (!custom) {
                [state.baseWidth, state.baseDepth] = input.value.split("x").map(Number);
                field("baseWidth").value = state.baseWidth;
                field("baseDepth").value = state.baseDepth;
            }
        } else if (name === "template") {
            state.template = Number(input.value);
        } else if (name === "missingFrom") {
            state.missingFrom = input.value;
        } else return;
        error();
        rebuild();
    }

    function point(event) {
        return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    }

    function scheduleHits() {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateHits(); });
    }

    function onPointerDown(event) {
        if (!event.isPrimary || event.button !== 0) return;
        const position = point(event);
        const current = circle();
        const inside = Math.hypot(position.x - current.x, position.y - current.y) <= current.radius;
        drag = {id: event.pointerId, x: inside ? position.x - current.x : 0, y: inside ? position.y - current.y : 0};
        svg.setPointerCapture(event.pointerId);
        svg.classList.add("dragging");
        svg.focus({preventScroll: true});
        onPointerMove(event);
    }

    function onPointerMove(event) {
        if (!drag || drag.id !== event.pointerId) return;
        const position = point(event);
        state.offsetX = position.x - drag.x - state.files * state.baseWidth / 2;
        state.offsetY = position.y - drag.y - state.ranks * state.baseDepth / 2;
        scheduleHits();
    }

    function onPointerEnd(event) {
        if (!drag || drag.id !== event.pointerId) return;
        drag = null;
        svg.classList.remove("dragging");
        if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        save();
    }

    function center() {
        state.offsetX = 0;
        state.offsetY = 0;
        updateHits();
        save();
    }

    function onKeyDown(event) {
        const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        state.offsetX += direction[0] * distance;
        state.offsetY += direction[1] * distance;
        updateHits();
        save();
    }

    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("focusout", onBlur);
    root.querySelector("[data-template-center]").addEventListener("click", center);
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerEnd);
    svg.addEventListener("pointercancel", onPointerEnd);
    svg.addEventListener("lostpointercapture", onPointerEnd);
    svg.addEventListener("keydown", onKeyDown);
    rebuild();

    return () => {
        save();
        if (frame) cancelAnimationFrame(frame);
        root.removeEventListener("input", onInput);
        root.removeEventListener("change", onChange);
        root.removeEventListener("focusout", onBlur);
        root.querySelector("[data-template-center]").removeEventListener("click", center);
        svg.removeEventListener("pointerdown", onPointerDown);
        svg.removeEventListener("pointermove", onPointerMove);
        svg.removeEventListener("pointerup", onPointerEnd);
        svg.removeEventListener("pointercancel", onPointerEnd);
        svg.removeEventListener("lostpointercapture", onPointerEnd);
        svg.removeEventListener("keydown", onKeyDown);
    };
}
