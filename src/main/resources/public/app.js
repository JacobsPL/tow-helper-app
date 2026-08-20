const app = document.getElementById("app");

let catalog = null;
let loreById = new Map();
let spellsById = new Map();
let factionById = new Map();
let session = null;
let serverWarnings = [];
let serverErrors = [];
let selectionDraft = null;
let boundEditor = null;
let cardPreview = null;

const SIDES = [
    {id: "PLAYER", label: "Gracz"},
    {id: "OPPONENT", label: "Przeciwnik"}
];

class ApiError extends Error {
    constructor(errors) {
        super(errors?.[0]?.message || "Błąd API");
        this.errors = errors || [];
    }
}

window.addEventListener("hashchange", route);

app.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.action === "create-session") {
        await createSession();
    }
    if (form.dataset.action === "add-mage") {
        await addMage(form);
    }
});

app.addEventListener("change", async (event) => {
    const target = event.target;
    const action = target.dataset.change;
    if (!action) {
        return;
    }

    if (action === "side-faction") {
        await updateSideFaction(target);
    }
    if (action === "add-caster-preset") {
        updateAddMagePreset(target);
    }
    if (action.startsWith("mage-")) {
        await updateMageField(target);
    }
    if (action.startsWith("bound-")) {
        updateBoundDraft(target);
    }
});

app.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.change === "bound-field" && target.dataset.field === "name" && boundEditor) {
        boundEditor.draft.name = target.value;
        boundEditor.error = "";
    }
});

app.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
        return;
    }

    const action = button.dataset.action;
    if (action === "create-session") {
        await createSession();
    } else if (action === "open-last-session") {
        openLastSession();
    } else if (action === "delete-mage") {
        await deleteMage(button.dataset.mageId);
    } else if (action === "choose-spells") {
        openMageSpells(button.dataset.mageId);
    } else if (action === "toggle-select-spell") {
        toggleSelectedSpell(button.dataset.spellId);
    } else if (action === "confirm-spell-selection") {
        await confirmSpellSelection();
    } else if (action === "cancel-spell-selection") {
        selectionDraft = null;
        goToSession();
    } else if (action === "open-bound-editor") {
        openBoundEditor(button.dataset.ownerMageId || "", button.dataset.boundId || "", button.dataset.side || "");
    } else if (action === "close-bound-editor") {
        boundEditor = null;
        renderCurrent();
    } else if (action === "open-card-preview") {
        openCardPreview(button.dataset.spellId, button.dataset.casterLevel, button.dataset.casterKind);
    } else if (action === "close-card-preview") {
        cardPreview = null;
        renderCurrent();
    } else if (action === "choose-bound-spell") {
        chooseBoundSpell(button.dataset.spellId);
    } else if (action === "save-bound-spell") {
        await saveBoundSpell();
    } else if (action === "delete-bound-spell") {
        await deleteBoundSpell(button.dataset.ownerMageId || "", button.dataset.boundId);
    } else if (action === "reset-side") {
        await resetSide(button.dataset.side);
    } else if (action === "start-game") {
        await startGame();
    } else if (action === "back-to-config") {
        session.mode = "CONFIG";
        session.usedCards = [];
        await saveSession();
        renderConfig();
    } else if (action === "toggle-used-card") {
        await toggleUsedCard(button.dataset.cardKey);
    } else if (action === "end-turn") {
        await endTurn();
    }
});

init();

async function init() {
    try {
        catalog = await api("/api/catalog");
        loreById = new Map(catalog.lores.map((lore) => [lore.id, lore]));
        spellsById = new Map(catalog.spells.map((spell) => [spell.id, spell]));
        factionById = new Map((catalog.factions || []).map((faction) => [faction.id, faction]));
        await route();
    } catch (error) {
        app.innerHTML = `<div class="page"><div class="notice error">${escapeHtml(error.message)}</div></div>`;
    }
}

async function route() {
    const parts = hashParts();
    if (parts[0] !== "session" || !parts[1]) {
        session = null;
        renderHome();
        return;
    }

    try {
        await loadSession(parts[1]);
    } catch (error) {
        if (error instanceof ApiError) {
            renderMissingSession(parts[1], error.errors);
            return;
        }
        throw error;
    }

    if (parts[2] === "mage" && parts[3] && parts[4] === "spells") {
        renderSpellSelection(parts[3]);
        return;
    }

    selectionDraft = null;
    if (session.mode === "GAME") {
        renderGame();
    } else {
        renderConfig();
    }
}

function hashParts() {
    return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new ApiError(data?.errors || [{message: response.statusText}]);
    }
    return data;
}

async function createSession() {
    const response = await api("/api/sessions", {method: "POST"});
    applySessionResponse(response);
    localStorage.setItem("tow-helper-last-session", session.id);
    window.location.hash = `#/session/${session.id}`;
}

function openLastSession() {
    const id = localStorage.getItem("tow-helper-last-session");
    if (id) {
        window.location.hash = `#/session/${id}`;
    }
}

async function loadSession(id) {
    const response = await api(`/api/sessions/${encodeURIComponent(id)}`);
    applySessionResponse(response);
    localStorage.setItem("tow-helper-last-session", session.id);
}

function applySessionResponse(response) {
    session = response.session;
    serverWarnings = response.warnings || [];
    serverErrors = response.errors || [];
    ensureSessionShape();
}

async function saveSession() {
    ensureSessionShape();
    const response = await api(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PUT",
        body: JSON.stringify(session)
    });
    applySessionResponse(response);
}

function ensureSessionShape() {
    session.mages ||= [];
    session.boundSpells ||= [];
    session.usedCards ||= [];
    session.playerFactionId = normalizeFactionId(session.playerFactionId);
    session.opponentFactionId = normalizeFactionId(session.opponentFactionId);
    for (const mage of session.mages) {
        mage.side = normalizeSide(mage.side);
        mage.casterPresetId ||= "";
        mage.note ||= "";
        mage.spellIds ||= [];
        mage.boundSpells ||= [];
        for (const boundSpell of mage.boundSpells) {
            boundSpell.side = mage.side;
            boundSpell.sourceId ||= "";
        }
    }
    for (const boundSpell of session.boundSpells) {
        boundSpell.side = normalizeSide(boundSpell.side);
        boundSpell.sourceId ||= "";
    }
}

function renderHome() {
    const lastSession = localStorage.getItem("tow-helper-last-session");
    app.innerHTML = `
        <main class="page">
            <section class="home-panel">
                <div>
                    <h1>TOW Helper</h1>
                    <p>Pomocnik do obsługi magii w Warhammer: The Old World.</p>
                </div>
                <p>Utwórz osobną sesję gry dla stołu. Każda sesja ma własny identyfikator i zapisuje magów, czary oraz użycie kart po odświeżeniu strony.</p>
                <div class="actions">
                    <button type="button" data-action="create-session">Utwórz nową sesję</button>
                    ${lastSession ? `<button type="button" class="secondary" data-action="open-last-session">Otwórz ostatnią sesję</button>` : ""}
                </div>
            </section>
        </main>
    `;
}

function renderMissingSession(id, errors) {
    app.innerHTML = `
        <main class="page">
            <section class="home-panel">
                <div>
                    <h1>Nie znaleziono sesji</h1>
                    <p>Identyfikator: ${escapeHtml(id)}</p>
                </div>
                ${renderMessages(errors, "error")}
                <div class="actions">
                    <button type="button" data-action="create-session">Utwórz nową sesję</button>
                </div>
            </section>
        </main>
    `;
}

function renderTopBar(label, actions = "") {
    return `
        <header class="top-bar">
            <div class="brand">
                <strong>TOW Helper</strong>
                <span>${escapeHtml(label)}</span>
            </div>
            <div class="actions">${actions}</div>
        </header>
    `;
}

function renderConfig() {
    app.innerHTML = `
        ${renderTopBar(`Konfiguracja sesji ${shortId(session.id)}`, `
            <button type="button" class="warning" data-action="start-game">Rozpocznij grę</button>
        `)}
        <main class="page">
            <div class="page-title">
                <h1>Konfiguracja sesji</h1>
                <p>Dodaj magów, wybierz Lore i przypisz czary. Bound Spells mogą być niezależne albo przypisane do konkretnego maga.</p>
            </div>
            <div class="config-controls">
                <button type="button" class="secondary" data-action="reset-side" data-side="PLAYER">Reset gracza</button>
                <button type="button" class="secondary" data-action="reset-side" data-side="OPPONENT">Reset przeciwnika</button>
            </div>
            <div class="config-messages">
                ${renderMessages(serverErrors, "error")}
                ${renderMessages(serverWarnings, "warning")}
            </div>
            <div class="duel-grid">
                ${SIDES.map((side) => renderConfigSide(side.id)).join("")}
            </div>
        </main>
        ${renderBoundModal()}
        ${renderCardPreviewModal()}
    `;
}

function renderConfigSide(side) {
    const mages = magesForSide(side);
    const boundSpells = boundSpellsForSide(side);
    const faction = factionForSide(side);
    return `
        <section class="side-column">
            <div class="side-heading">
                <div>
                    <h2>${escapeHtml(sideLabel(side))}</h2>
                    <span>${faction ? `${escapeHtml(faction.name)} · ` : ""}${mages.length} magów · ${boundSpells.length} niezależnych Bound Spells</span>
                </div>
            </div>
            ${renderFactionPicker(side)}
            ${faction ? `
                ${renderAddMageForm(side)}
                ${mages.length ? mages.map(renderMagePanel).join("") : `<div class="empty-panel">Brak magów po tej stronie.</div>`}
                ${renderIndependentBoundSpells(side)}
            ` : `<div class="empty-panel">Wybierz frakcję, żeby dodać magów i Bound Spells po tej stronie.</div>`}
        </section>
    `;
}

function renderFactionPicker(side) {
    const selected = factionIdForSide(side);
    const faction = factionForSide(side);
    const loreCount = availableLoresForSide(side, "mage").length;
    return `
        <section class="form-panel faction-panel">
            <div class="panel-title">
                <h2>Frakcja</h2>
                <span>${faction ? `${loreCount} dostępnych Lore dla tej frakcji` : "Najpierw wybierz główną frakcję dla tej strony."}</span>
            </div>
            <label>Armia
                ${factionSelect(side, selected)}
            </label>
        </section>
    `;
}

function renderAddMageForm(side) {
    const hasAvailableLores = availableLoresForSide(side, "mage").length > 0;
    return `
        <form class="form-panel" data-action="add-mage">
            <input type="hidden" name="side" value="${escapeAttr(normalizeSide(side))}">
            <div class="panel-title">
                <h2>Dodaj maga</h2>
                <span>Wybierz postać z danych OWB albo zostaw własną nazwę. Poziom określa standardowy limit czarów.</span>
            </div>
            ${hasAvailableLores ? "" : renderMessages([{message: "Ta frakcja nie ma dostępnych Lore w danych OWB dla zwykłych magów."}], "warning")}
            <div class="form-grid mage-add-grid">
                <label>Postać
                    ${casterPresetSelect(side)}
                </label>
                <label>Nazwa / oznaczenie
                    <input name="name" required placeholder="np. Nekromanta" ${hasAvailableLores ? "" : "disabled"}>
                </label>
                <label>Poziom
                    ${levelSelect("level", 1, hasAvailableLores ? "" : "disabled")}
                </label>
                <label>Lore
                    ${loreSelect("loreId", "", "", side, "mage")}
                </label>
                <label>Komentarz
                    <input name="note" placeholder="np. generał, bunkier, artefakt" ${hasAvailableLores ? "" : "disabled"}>
                </label>
                <button type="submit" ${hasAvailableLores ? "" : "disabled"}>Dodaj</button>
            </div>
        </form>
    `;
}

async function addMage(form) {
    const formData = new FormData(form);
    const side = normalizeSide(formData.get("side"));
    const casterPresetId = normalizeCasterPresetId(side, formData.get("casterPresetId"));
    const loreId = String(formData.get("loreId") || "");
    const preset = casterPresetForSide(side, casterPresetId);
    if (!factionIdForSide(side) || !isLoreAvailableForSide(side, loreId, "mage", casterPresetId)) {
        renderConfig();
        return;
    }
    session.mages.push({
        id: crypto.randomUUID(),
        side,
        casterPresetId,
        name: String(formData.get("name") || "").trim() || preset?.name || "Mag",
        note: String(formData.get("note") || "").trim(),
        level: Number(formData.get("level") || 1),
        loreId,
        spellIds: [],
        boundSpells: []
    });
    await saveSession();
    renderConfig();
}

async function updateSideFaction(target) {
    const side = normalizeSide(target.dataset.side);
    const currentFactionId = factionIdForSide(side);
    const nextFactionId = normalizeFactionId(target.value);
    const hasContent = magesForSide(side).length || boundSpellsForSide(side).length;
    if (hasContent && currentFactionId !== nextFactionId && !confirm(`Zmienić frakcję strony "${sideLabel(side)}"? Niedostępne dla nowej frakcji Lore i czary zostaną wyczyszczone.`)) {
        target.value = currentFactionId;
        return;
    }
    setFactionForSide(side, nextFactionId);
    await saveSession();
    renderConfig();
}

function updateAddMagePreset(target) {
    const form = target.closest("form");
    if (!form) {
        return;
    }
    const side = normalizeSide(form.querySelector('input[name="side"]')?.value);
    const preset = casterPresetForSide(side, target.value);
    const nameInput = form.querySelector('input[name="name"]');
    const levelSelectElement = form.querySelector('select[name="level"]');
    const loreSelectElement = form.querySelector('select[name="loreId"]');
    if (preset && nameInput && !nameInput.value.trim()) {
        nameInput.value = preset.name;
    }
    if (preset && levelSelectElement) {
        levelSelectElement.value = String(preset.defaultLevel || 1);
    }
    if (loreSelectElement) {
        const lores = availableLoresForSide(side, "mage", preset?.id || "");
        loreSelectElement.innerHTML = loreOptionsHtml(lores, lores[0]?.id || "");
        loreSelectElement.disabled = lores.length === 0;
    }
}

function renderMagePanel(mage) {
    const selectedSpells = mage.spellIds.map((id) => spellsById.get(id)).filter(Boolean);
    const warnings = mageWarnings(mage);
    const canAddBoundSpell = availableLoresForSide(mage.side, "bound").length > 0;
    const preset = casterPresetForSide(mage.side, mage.casterPresetId);
    return `
        <article class="mage-panel">
            <div class="panel-head">
                <div class="panel-title">
                    <h2>${escapeHtml(mage.name || "Mag")}</h2>
                    <span>Poziom ${mage.level} · ${mage.loreId ? escapeHtml(loreName(mage.loreId)) : "bez Lore"}${preset ? ` · ${escapeHtml(preset.name)}` : ""}</span>
                </div>
                <div class="actions">
                    <button type="button" class="secondary" data-action="choose-spells" data-mage-id="${escapeAttr(mage.id)}" ${mage.loreId ? "" : "disabled"}>Wybierz czary</button>
                    <button type="button" class="danger" data-action="delete-mage" data-mage-id="${escapeAttr(mage.id)}">Usuń</button>
                </div>
            </div>
            <div class="mage-edit-grid">
                <label>Nazwa
                    <input data-change="mage-name" data-mage-id="${escapeAttr(mage.id)}" value="${escapeAttr(mage.name || "")}">
                </label>
                <label>Poziom
                    ${levelSelect("", mage.level, `data-change="mage-level" data-mage-id="${escapeAttr(mage.id)}"`)}
                </label>
                <label>Lore
                    ${loreSelect("", mage.loreId, `data-change="mage-lore" data-mage-id="${escapeAttr(mage.id)}"`, mage.side, "mage", mage.casterPresetId)}
                </label>
            </div>
            <label class="wide-field">Komentarz
                <input data-change="mage-note" data-mage-id="${escapeAttr(mage.id)}" value="${escapeAttr(mage.note || "")}" placeholder="np. siedzi w łucznikach, ma przedmiot, cel przeciwnika">
            </label>
            ${renderMessages(warnings, "warning")}
            <div>
                <div class="subsection-title">
                    <h3>Wybrane czary</h3>
                    <span class="hint">${selectedSpells.length}/${mage.level} standardowo</span>
                </div>
                <div class="chips">
                    ${selectedSpells.length ? selectedSpells.map((spell) => `<span class="chip">${escapeHtml(spell.spellName)}</span>`).join("") : `<span class="hint">Brak wybranych czarów.</span>`}
                </div>
            </div>
            <div>
                <div class="subsection-title">
                    <h3>Bound Spells maga</h3>
                    <button type="button" class="secondary" data-action="open-bound-editor" data-owner-mage-id="${escapeAttr(mage.id)}" data-side="${escapeAttr(mage.side)}" ${canAddBoundSpell ? "" : "disabled"}>Dodaj Bound Spell</button>
                </div>
                ${renderBoundList(mage.boundSpells, mage.id, mage.side)}
            </div>
        </article>
    `;
}

async function updateMageField(target) {
    const mage = findMage(target.dataset.mageId);
    if (!mage) {
        return;
    }
    if (target.dataset.change === "mage-name") {
        mage.name = target.value.trim();
    }
    if (target.dataset.change === "mage-note") {
        mage.note = target.value.trim();
    }
    if (target.dataset.change === "mage-level") {
        mage.level = Number(target.value);
    }
    if (target.dataset.change === "mage-lore") {
        mage.loreId = isLoreAvailableForSide(mage.side, target.value, "mage", mage.casterPresetId) ? target.value : "";
        mage.spellIds = [];
        mage.boundSpells = [];
    }
    await saveSession();
    renderConfig();
}

async function deleteMage(mageId) {
    const mage = findMage(mageId);
    if (!mage || !confirm(`Usunąć maga "${mage.name || "Mag"}" razem z jego czarami i Bound Spells?`)) {
        return;
    }
    session.mages = session.mages.filter((item) => item.id !== mageId);
    await saveSession();
    renderConfig();
}

function openMageSpells(mageId) {
    const mage = findMage(mageId);
    if (!mage || !mage.loreId) {
        return;
    }
    window.location.hash = `#/session/${session.id}/mage/${mageId}/spells`;
}

function renderSpellSelection(mageId) {
    const mage = findMage(mageId);
    if (!mage) {
        goToSession();
        return;
    }
    if (!selectionDraft || selectionDraft.mageId !== mageId) {
        selectionDraft = {mageId, spellIds: [...mage.spellIds]};
    }

    const lore = loreById.get(mage.loreId);
    const selectedCount = selectionDraft.spellIds.length;
    const warnings = mageWarnings(mage, selectedCount);
    const canAddBoundSpell = availableLoresForSide(mage.side, "bound").length > 0;
    if (selectedCount === 0) {
        warnings.push({message: "Nie wybrano żadnego czaru. Możesz zatwierdzić, jeśli to zamierzone."});
    }

    app.innerHTML = `
        ${renderTopBar(`Wybór czarów · ${sideLabel(mage.side)} · ${mage.name || "Mag"}`, `
            <button type="button" class="secondary" data-action="cancel-spell-selection">Wróć</button>
        `)}
        <main class="page">
            <div class="selection-toolbar">
                <div class="panel-title">
                    <h2>${escapeHtml(lore?.name || "Lore")}</h2>
                    <span>${selectedCount} wybranych · standardowy limit poziomu ${mage.level}: ${mage.level}</span>
                </div>
                <div class="actions">
                    <button type="button" class="secondary" data-action="open-bound-editor" data-owner-mage-id="${escapeAttr(mage.id)}" data-side="${escapeAttr(mage.side)}" ${canAddBoundSpell ? "" : "disabled"}>Dodaj Bound Spell</button>
                    <button type="button" data-action="confirm-spell-selection">Zatwierdź wybór</button>
                </div>
            </div>
            ${renderMessages(warnings, "warning")}
            <div class="card-grid">
                ${(lore?.spells || []).map((spell) => renderSpellCard(spell, {
                    flipped: selectionDraft.spellIds.includes(spell.id),
                    selected: selectionDraft.spellIds.includes(spell.id),
                    action: "toggle-select-spell",
                    casterLevel: mage.level
                })).join("")}
            </div>
            <section class="form-panel spell-selection-bound-panel">
                <div class="subsection-title">
                    <h3>Bound Spells przypisane do maga</h3>
                    <button type="button" class="secondary" data-action="open-bound-editor" data-owner-mage-id="${escapeAttr(mage.id)}" data-side="${escapeAttr(mage.side)}" ${canAddBoundSpell ? "" : "disabled"}>Dodaj Bound Spell</button>
                </div>
                ${renderBoundList(mage.boundSpells, mage.id, mage.side)}
            </section>
        </main>
        ${renderBoundModal()}
        ${renderCardPreviewModal()}
    `;
}

function toggleSelectedSpell(spellId) {
    if (!selectionDraft) {
        return;
    }
    if (selectionDraft.spellIds.includes(spellId)) {
        selectionDraft.spellIds = selectionDraft.spellIds.filter((id) => id !== spellId);
    } else {
        selectionDraft.spellIds.push(spellId);
    }
    renderSpellSelection(selectionDraft.mageId);
}

async function confirmSpellSelection() {
    const mage = findMage(selectionDraft?.mageId);
    if (!mage) {
        return;
    }
    mage.spellIds = [...selectionDraft.spellIds];
    selectionDraft = null;
    await saveSession();
    goToSession();
}

function renderIndependentBoundSpells(side) {
    const boundSpells = boundSpellsForSide(side);
    const canAddBoundSpell = availableLoresForSide(side, "bound").length > 0;
    return `
        <section class="form-panel">
            <div class="subsection-title">
                <div class="panel-title">
                    <h2>Niezależne Bound Spells</h2>
                    <span>Dla jednostek, przedmiotów albo źródeł niezwiązanych z magiem.</span>
                </div>
                <button type="button" class="secondary" data-action="open-bound-editor" data-side="${escapeAttr(side)}" ${canAddBoundSpell ? "" : "disabled"}>Dodaj Bound Spell</button>
            </div>
            ${renderBoundList(boundSpells, "", side)}
        </section>
    `;
}

function renderBoundList(boundSpells, ownerMageId, side = "PLAYER") {
    if (!boundSpells?.length) {
        return `<div class="empty-panel">Brak Bound Spells.</div>`;
    }
    return `
        <div class="bound-list">
            ${boundSpells.map((boundSpell) => {
                const spell = spellsById.get(boundSpell.spellId);
                return `
                    <div class="bound-row">
                        <div>
                            <strong>${escapeHtml(boundSpell.name || "Bound Spell")}</strong>
                            <span>${escapeHtml(loreName(boundSpell.loreId))} · poziom ${boundSpell.level} · ${escapeHtml(spell?.spellName || "bez czaru")}</span>
                        </div>
                        <div class="actions">
                            <button type="button" class="secondary" data-action="open-bound-editor" data-owner-mage-id="${escapeAttr(ownerMageId)}" data-bound-id="${escapeAttr(boundSpell.id)}" data-side="${escapeAttr(side)}">Edytuj</button>
                            <button type="button" class="danger" data-action="delete-bound-spell" data-owner-mage-id="${escapeAttr(ownerMageId)}" data-bound-id="${escapeAttr(boundSpell.id)}">Usuń</button>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function openBoundEditor(ownerMageId, boundId, side = "") {
    const existing = findBoundSpell(ownerMageId, boundId);
    const owner = findMage(ownerMageId);
    const editorSide = normalizeSide(owner?.side || side);
    const firstLore = availableLoresForSide(editorSide, "bound")[0]?.id || "";
    if (!existing && !firstLore) {
        return;
    }
    boundEditor = {
        ownerMageId,
        boundId,
        side: editorSide,
        error: "",
        draft: existing ? structuredClone(existing) : {
            id: crypto.randomUUID(),
            side: editorSide,
            sourceId: "",
            name: "Bound Spell",
            level: 1,
            loreId: firstLore,
            spellId: ""
        }
    };
    boundEditor.draft.side = editorSide;
    renderCurrent();
}

function updateBoundDraft(target) {
    if (!boundEditor) {
        return;
    }
    const field = target.dataset.field;
    if (field === "name") {
        boundEditor.draft.name = target.value;
    }
    if (field === "level") {
        boundEditor.draft.level = Number(target.value);
    }
    if (field === "sourceId") {
        applyBoundSource(target.value);
    }
    if (field === "loreId") {
        boundEditor.draft.loreId = isLoreAvailableForSide(boundEditor.side, target.value, "bound") ? target.value : "";
        boundEditor.draft.spellId = "";
    }
    boundEditor.error = "";
    renderCurrent();
}

function applyBoundSource(sourceId) {
    if (!boundEditor) {
        return;
    }
    const source = boundSpellSourceForSide(boundEditor.side, sourceId);
    boundEditor.draft.sourceId = source?.id || "";
    if (!source) {
        return;
    }
    boundEditor.draft.name = source.name;
    if (source.powerLevel > 0) {
        boundEditor.draft.level = source.powerLevel;
    }
    boundEditor.draft.loreId = source.loreIds[0] || "";
    boundEditor.draft.spellId = source.spellId || "";
}

function chooseBoundSpell(spellId) {
    if (!boundEditor) {
        return;
    }
    boundEditor.draft.spellId = spellId;
    boundEditor.error = "";
    renderCurrent();
}

async function saveBoundSpell() {
    if (!boundEditor) {
        return;
    }
    const draft = boundEditor.draft;
    if (!draft.loreId || !draft.spellId) {
        boundEditor.error = "Bound Spell musi mieć Lore i dokładnie jeden wybrany czar.";
        renderCurrent();
        return;
    }
    if (!isLoreAvailableForSide(boundEditor.side, draft.loreId, "bound")) {
        boundEditor.error = "Wybrane Lore nie jest dostępne dla tej frakcji.";
        renderCurrent();
        return;
    }
    draft.name = draft.name?.trim() || "Bound Spell";
    draft.side = boundEditor.ownerMageId
        ? normalizeSide(findMage(boundEditor.ownerMageId)?.side)
        : normalizeSide(boundEditor.side || draft.side);

    const list = boundEditor.ownerMageId
        ? findMage(boundEditor.ownerMageId)?.boundSpells
        : session.boundSpells;
    if (!list) {
        return;
    }

    const index = list.findIndex((item) => item.id === draft.id);
    if (index >= 0) {
        list[index] = structuredClone(draft);
    } else {
        list.push(structuredClone(draft));
    }

    boundEditor = null;
    await saveSession();
    renderCurrent();
}

async function deleteBoundSpell(ownerMageId, boundId) {
    const list = ownerMageId ? findMage(ownerMageId)?.boundSpells : session.boundSpells;
    if (!list || !confirm("Usunąć ten Bound Spell?")) {
        return;
    }
    const next = list.filter((item) => item.id !== boundId);
    if (ownerMageId) {
        findMage(ownerMageId).boundSpells = next;
    } else {
        session.boundSpells = next;
    }
    await saveSession();
    renderCurrent();
}

async function resetSide(side) {
    const normalizedSide = normalizeSide(side);
    const label = sideLabel(normalizedSide);
    const hasContent = factionIdForSide(normalizedSide) || magesForSide(normalizedSide).length || boundSpellsForSide(normalizedSide).length;
    if (!hasContent) {
        return;
    }
    if (!confirm(`Zresetować stronę "${label}"? Usunie to frakcję, magów, ich czary oraz niezależne Bound Spells tylko z tej strony.`)) {
        return;
    }
    session.mages = session.mages.filter((mage) => normalizeSide(mage.side) !== normalizedSide);
    session.boundSpells = session.boundSpells.filter((boundSpell) => normalizeSide(boundSpell.side) !== normalizedSide);
    setFactionForSide(normalizedSide, "");
    await saveSession();
    renderConfig();
}

function renderBoundModal() {
    if (!boundEditor) {
        return "";
    }
    const draft = boundEditor.draft;
    const lore = loreById.get(draft.loreId);
    return `
        <div class="modal-backdrop">
            <section class="modal">
                <div class="panel-head">
                    <div class="panel-title">
                        <h2>${boundEditor.boundId ? "Edytuj Bound Spell" : "Dodaj Bound Spell"}</h2>
                        <span>${boundEditor.ownerMageId ? "Przypisany do maga" : "Niezależny element sesji"} · ${escapeHtml(sideLabel(boundEditor.side))}</span>
                    </div>
                    <button type="button" class="secondary" data-action="close-bound-editor">Zamknij</button>
                </div>
                ${boundEditor.error ? renderMessages([{message: boundEditor.error}], "error") : ""}
                <div class="modal-grid">
                    <label>Źródło
                        ${boundSourceSelect(boundEditor.side, draft.sourceId || "")}
                    </label>
                    <label>Nazwa
                        <input data-change="bound-field" data-field="name" value="${escapeAttr(draft.name || "")}">
                    </label>
                    <label>Poziom
                        ${levelSelect("", draft.level, `data-change="bound-field" data-field="level"`)}
                    </label>
                    <label>Lore
                        ${loreSelect("", draft.loreId, `data-change="bound-field" data-field="loreId"`, boundEditor.side, "bound")}
                    </label>
                </div>
                <div class="hint">Wybierz dokładnie jeden czar. Bound Spell nie wlicza się do limitu czarów maga.</div>
                <div class="card-grid">
                    ${(lore?.spells || []).map((spell) => renderSpellCard(spell, {
                        flipped: draft.spellId === spell.id,
                        selected: draft.spellId === spell.id,
                        action: "choose-bound-spell",
                        casterLevel: draft.level,
                        casterKind: "bound"
                    })).join("")}
                </div>
                <div class="actions">
                    <button type="button" data-action="save-bound-spell">Zapisz Bound Spell</button>
                    <button type="button" class="secondary" data-action="close-bound-editor">Anuluj</button>
                </div>
            </section>
        </div>
    `;
}

async function startGame() {
    try {
        const response = await api(`/api/sessions/${encodeURIComponent(session.id)}/start`, {method: "POST"});
        applySessionResponse(response);
        renderGame();
    } catch (error) {
        if (error instanceof ApiError) {
            serverErrors = error.errors;
            renderConfig();
        } else {
            throw error;
        }
    }
}

function renderGame() {
    app.innerHTML = `
        ${renderTopBar(`Gra · sesja ${shortId(session.id)}`, `
            <button type="button" class="secondary" data-action="back-to-config">Konfiguracja</button>
            <button type="button" class="warning" data-action="end-turn">Zakończ turę</button>
        `)}
        <main class="page">
            <div class="game-hint">
                Kliknij kartę, aby oznaczyć czar jako użyty w tej turze. To osobny stan od wyboru czarów.
            </div>
            <div class="duel-grid game-duel-grid">
                ${SIDES.map((side) => renderGameSide(side.id)).join("")}
            </div>
        </main>
        ${renderCardPreviewModal()}
    `;
}

function renderGameSide(side) {
    const mages = magesForSide(side);
    const boundSpells = boundSpellsForSide(side);
    const faction = factionForSide(side);
    return `
        <section class="side-column game-side">
            <div class="side-heading">
                <div>
                    <h2>${escapeHtml(sideLabel(side))}</h2>
                    <span>${faction ? `${escapeHtml(faction.name)} · ` : ""}${mages.length} magów · ${boundSpells.length} niezależnych Bound Spells</span>
                </div>
            </div>
            ${mages.length ? mages.map(renderMageGameSection).join("") : `<div class="empty-panel">Brak magów po tej stronie.</div>`}
            ${renderIndependentBoundGameSection(side)}
        </section>
    `;
}

function renderMageGameSection(mage) {
    const spells = mage.spellIds.map((id) => spellsById.get(id)).filter(Boolean);
    return `
        <article class="game-section">
            <div class="panel-title">
                <h2>${escapeHtml(mage.name || "Mag")}</h2>
                <span>Poziom ${mage.level} · ${escapeHtml(loreName(mage.loreId))}</span>
            </div>
            ${mage.note ? `<div class="mage-note">${escapeHtml(mage.note)}</div>` : ""}
            <div class="subsection-title"><h3>Czary</h3></div>
            ${spells.length ? `<div class="card-grid">${spells.map((spell) => renderGameSpellCard(mage, spell)).join("")}</div>` : `<div class="empty-panel">Ten mag nie ma wybranych czarów.</div>`}
            <div class="subsection-title"><h3>Bound Spells</h3></div>
            ${mage.boundSpells.length ? `<div class="card-grid">${mage.boundSpells.map(renderGameBoundCard).join("")}</div>` : `<div class="empty-panel">Brak Bound Spells przypisanych do maga.</div>`}
        </article>
    `;
}

function renderIndependentBoundGameSection(side) {
    const boundSpells = boundSpellsForSide(side);
    return `
        <article class="game-section">
            <div class="panel-title">
                <h2>Niezależne Bound Spells</h2>
                <span>Jednostki, przedmioty i pozostałe źródła poza magami.</span>
            </div>
            ${boundSpells.length ? `<div class="card-grid">${boundSpells.map(renderGameBoundCard).join("")}</div>` : `<div class="empty-panel">Brak niezależnych Bound Spells.</div>`}
        </article>
    `;
}

function renderGameSpellCard(mage, spell) {
    const key = `spell:${mage.id}:${spell.id}`;
    return renderSpellCard(spell, {
        flipped: session.usedCards.includes(key),
        used: session.usedCards.includes(key),
        action: "toggle-used-card",
        cardKey: key,
        casterLevel: mage.level
    });
}

function renderGameBoundCard(boundSpell) {
    const spell = spellsById.get(boundSpell.spellId);
    if (!spell) {
        return "";
    }
    const key = `bound:${boundSpell.id}`;
    return `
        <div>
            <div class="bound-card-meta">
                <span class="chip bound bound-name" title="${escapeAttr(boundSpell.name || "Bound Spell")}">${escapeHtml(boundSpell.name || "Bound Spell")}</span>
                <span class="bound-level">poziom ${boundSpell.level}</span>
            </div>
            ${renderSpellCard(spell, {
                flipped: session.usedCards.includes(key),
                used: session.usedCards.includes(key),
                action: "toggle-used-card",
                cardKey: key,
                casterLevel: boundSpell.level,
                casterKind: "bound"
            })}
        </div>
    `;
}

async function toggleUsedCard(cardKey) {
    const response = await api(`/api/sessions/${encodeURIComponent(session.id)}/used`, {
        method: "POST",
        body: JSON.stringify({key: cardKey})
    });
    applySessionResponse(response);
    renderGame();
}

async function endTurn() {
    if (!confirm("Zakończyć turę i odwrócić wszystkie użyte karty awersem do góry?")) {
        return;
    }
    const response = await api(`/api/sessions/${encodeURIComponent(session.id)}/end-turn`, {method: "POST"});
    applySessionResponse(response);
    renderGame();
}

function renderSpellCard(spell, options) {
    const imageUrl = options.flipped ? spell.backUrl : spell.frontUrl;
    const casterKind = options.casterKind || "wizard";
    const actualValue = actualCastingValue(spell.castingValue, options.casterLevel, casterKind);
    const classes = ["spell-card"];
    if (options.selected) {
        classes.push("selected");
    }
    if (options.used) {
        classes.push("used");
    }
    const extra = [
        options.cardKey ? `data-card-key="${escapeAttr(options.cardKey)}"` : "",
        options.casterLevel ? `data-caster-level="${escapeAttr(options.casterLevel)}"` : "",
        options.casterLevel ? `data-caster-kind="${escapeAttr(casterKind)}"` : ""
    ].filter(Boolean).join(" ");
    return `
        <div class="spell-card-wrap">
            <button type="button" class="${classes.join(" ")}" data-action="${escapeAttr(options.action)}" data-spell-id="${escapeAttr(spell.id)}" ${extra}>
                <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(spell.spellName)}" loading="lazy">
                <span class="spell-caption">
                    <strong>${escapeHtml(spell.spellName)}</strong>
                    <span>${escapeHtml(spell.type)} · ${escapeHtml(spell.castingValue)} · ${escapeHtml(spell.range)}</span>
                    ${actualValue ? `<span class="actual-casting">Actual CV: ${escapeHtml(actualValue)}</span>` : ""}
                </span>
            </button>
            <button type="button" class="secondary detail-button" data-action="open-card-preview" data-spell-id="${escapeAttr(spell.id)}" ${options.casterLevel ? `data-caster-level="${escapeAttr(options.casterLevel)}" data-caster-kind="${escapeAttr(casterKind)}"` : ""}>Pokaż szczegóły</button>
        </div>
    `;
}

function openCardPreview(spellId, casterLevel = 0, casterKind = "wizard") {
    const spell = spellsById.get(spellId);
    if (!spell) {
        return;
    }
    cardPreview = {spellId, casterLevel: Number(casterLevel || 0), casterKind: casterKind || "wizard"};
    renderCurrent();
}

function renderCardPreviewModal() {
    if (!cardPreview) {
        return "";
    }
    const spell = spellsById.get(cardPreview.spellId);
    if (!spell) {
        return "";
    }
    const actualValue = actualCastingValue(spell.castingValue, cardPreview.casterLevel, cardPreview.casterKind);
    return `
        <div class="modal-backdrop">
            <section class="modal card-preview-modal">
                <div class="panel-head">
                    <div class="panel-title">
                        <h2>${escapeHtml(spell.spellName)}</h2>
                        <span>${escapeHtml(spell.loreName)} · ${escapeHtml(spell.type)} · ${escapeHtml(spell.castingValue)} · ${escapeHtml(spell.range)}${actualValue ? ` · Actual CV: ${escapeHtml(actualValue)}` : ""}</span>
                    </div>
                    <button type="button" class="secondary" data-action="close-card-preview">Zamknij</button>
                </div>
                <div class="card-preview-frame">
                    <img class="card-preview-image" src="${escapeAttr(spell.frontUrl)}" alt="${escapeAttr(spell.spellName)}">
                </div>
            </section>
        </div>
    `;
}

function actualCastingValue(castingValue, casterLevel, casterKind = "wizard") {
    const level = Number(casterLevel || 0);
    if (!castingValue || level < 1) {
        return "";
    }
    const modifier = casterKind === "bound" ? level : (level >= 3 ? 2 : 1);
    return castingValue.replace(/\d+\s*\+/g, (value) => {
        const target = Math.max(2, Number.parseInt(value, 10) - modifier);
        return `${target}+`;
    });
}

function renderMessages(messages, kind) {
    if (!messages?.length) {
        return "";
    }
    const className = kind === "error" ? "notice error" : "notice";
    return `
        <div class="${kind === "error" ? "error-list" : "warning-list"}">
            ${messages.map((message) => `<div class="${className}">${escapeHtml(message.message || message)}</div>`).join("")}
        </div>
    `;
}

function mageWarnings(mage, selectedCount = mage.spellIds.length) {
    const warnings = [];
    if (!mage.loreId) {
        warnings.push({message: "Ten mag nie ma wybranego Lore."});
    }
    if (selectedCount > mage.level) {
        warnings.push({message: `Wybrano ${selectedCount} czarów, a standardowy limit poziomu ${mage.level} to ${mage.level}. Możesz zatwierdzić wyjątek.`});
    }
    return warnings;
}

function levelSelect(name, selected, attrs = "") {
    return `
        <select ${name ? `name="${escapeAttr(name)}"` : ""} ${attrs}>
            ${[1, 2, 3, 4].map((level) => `<option value="${level}" ${Number(selected) === level ? "selected" : ""}>${level}</option>`).join("")}
        </select>
    `;
}

function loreSelect(name, selected, attrs = "", side = "", kind = "mage", casterPresetId = "") {
    const lores = availableLoresForSide(side, kind, casterPresetId);
    const selectedLore = selected && !lores.some((lore) => lore.id === selected) ? loreById.get(selected) : null;
    const disabled = lores.length ? "" : "disabled";
    return `
        <select ${name ? `name="${escapeAttr(name)}"` : ""} ${attrs} ${disabled}>
            ${loreOptionsHtml(lores, selected, selectedLore)}
        </select>
    `;
}

function loreOptionsHtml(lores, selected, selectedLore = null) {
    return `
        <option value="">${lores.length ? "Wybierz Lore" : "Brak dostępnych Lore"}</option>
        ${selectedLore ? `<option value="${escapeAttr(selectedLore.id)}" selected>${escapeHtml(selectedLore.name)} (niedostępne)</option>` : ""}
        ${lores.map((lore) => `<option value="${escapeAttr(lore.id)}" ${selected === lore.id ? "selected" : ""}>${escapeHtml(lore.name)}</option>`).join("")}
    `;
}

function factionSelect(side, selected) {
    return `
        <select data-change="side-faction" data-side="${escapeAttr(normalizeSide(side))}">
            <option value="">Wybierz frakcję</option>
            ${(catalog.factions || []).map((faction) => `<option value="${escapeAttr(faction.id)}" ${selected === faction.id ? "selected" : ""}>${escapeHtml(faction.name)}</option>`).join("")}
        </select>
    `;
}

function casterPresetSelect(side) {
    const presets = casterPresetsForSide(side);
    return `
        <select name="casterPresetId" data-change="add-caster-preset" data-side="${escapeAttr(normalizeSide(side))}">
            <option value="">Własna nazwa</option>
            ${presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}
        </select>
    `;
}

function boundSourceSelect(side, selected) {
    const sources = boundSpellSourcesForSide(side);
    return `
        <select data-change="bound-field" data-field="sourceId">
            <option value="">Własny Bound Spell</option>
            ${sources.map((source) => `<option value="${escapeAttr(source.id)}" ${selected === source.id ? "selected" : ""}>${escapeHtml(source.name)}</option>`).join("")}
        </select>
    `;
}

function findMage(mageId) {
    return session?.mages?.find((mage) => mage.id === mageId);
}

function findBoundSpell(ownerMageId, boundId) {
    if (!boundId) {
        return null;
    }
    const list = ownerMageId ? findMage(ownerMageId)?.boundSpells : session.boundSpells;
    return list?.find((boundSpell) => boundSpell.id === boundId) || null;
}

function factionForSide(side) {
    return factionById.get(factionIdForSide(side)) || null;
}

function factionIdForSide(side) {
    return normalizeSide(side) === "OPPONENT" ? session.opponentFactionId : session.playerFactionId;
}

function setFactionForSide(side, factionId) {
    if (normalizeSide(side) === "OPPONENT") {
        session.opponentFactionId = normalizeFactionId(factionId);
    } else {
        session.playerFactionId = normalizeFactionId(factionId);
    }
}

function availableLoresForSide(side, kind = "mage", casterPresetId = "") {
    const faction = factionForSide(side);
    if (!faction) {
        return [];
    }
    if (kind === "bound") {
        return (faction.boundLoreIds || faction.loreIds || []).map((loreId) => loreById.get(loreId)).filter(Boolean);
    }
    const preset = casterPresetForSide(side, casterPresetId);
    const loreIds = preset?.loreIds || faction.loreIds || [];
    return loreIds.map((loreId) => loreById.get(loreId)).filter(Boolean);
}

function isLoreAvailableForSide(side, loreId, kind = "mage", casterPresetId = "") {
    return Boolean(loreId) && availableLoresForSide(side, kind, casterPresetId).some((lore) => lore.id === loreId);
}

function casterPresetsForSide(side) {
    return factionForSide(side)?.casterPresets || [];
}

function casterPresetForSide(side, casterPresetId) {
    if (!casterPresetId) {
        return null;
    }
    return casterPresetsForSide(side).find((preset) => preset.id === casterPresetId) || null;
}

function normalizeCasterPresetId(side, casterPresetId) {
    const normalized = String(casterPresetId || "").trim();
    return casterPresetForSide(side, normalized) ? normalized : "";
}

function boundSpellSourcesForSide(side) {
    return factionForSide(side)?.boundSpellSources || [];
}

function boundSpellSourceForSide(side, sourceId) {
    if (!sourceId) {
        return null;
    }
    return boundSpellSourcesForSide(side).find((source) => source.id === sourceId) || null;
}

function normalizeSide(side) {
    return String(side || "").toUpperCase() === "OPPONENT" ? "OPPONENT" : "PLAYER";
}

function normalizeFactionId(factionId) {
    const normalized = String(factionId || "").trim();
    return factionById.has(normalized) ? normalized : "";
}

function sideLabel(side) {
    return SIDES.find((item) => item.id === normalizeSide(side))?.label || "Gracz";
}

function magesForSide(side) {
    return session.mages.filter((mage) => normalizeSide(mage.side) === normalizeSide(side));
}

function boundSpellsForSide(side) {
    return session.boundSpells.filter((boundSpell) => normalizeSide(boundSpell.side) === normalizeSide(side));
}

function loreName(loreId) {
    return loreById.get(loreId)?.name || "bez Lore";
}

function goToSession() {
    window.location.hash = `#/session/${session.id}`;
}

function renderCurrent() {
    const parts = hashParts();
    if (parts[2] === "mage" && parts[3] && parts[4] === "spells") {
        renderSpellSelection(parts[3]);
    } else if (session.mode === "GAME") {
        renderGame();
    } else {
        renderConfig();
    }
}

function shortId(id) {
    return id ? id.slice(0, 8) : "";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}
