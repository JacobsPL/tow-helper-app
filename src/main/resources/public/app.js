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
const imagePreloadCache = new Map();
const queuedImagePreloads = new Set();
let imagePreloadHandle = 0;

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
        toggleSelectedSpell(button.dataset.spellId, button);
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
        chooseBoundSpell(button.dataset.spellId, button);
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
        await toggleUsedCard(button.dataset.cardKey, button);
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
        await createSession();
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

function queueSpellImagePreload(spell) {
    if (!spell) {
        return;
    }
    queueImagePreload([spell.frontUrl, spell.backUrl]);
}

function queueImagePreload(urls) {
    for (const url of urls || []) {
        if (url && !imagePreloadCache.has(url)) {
            queuedImagePreloads.add(url);
        }
    }
    if (!queuedImagePreloads.size || imagePreloadHandle) {
        return;
    }

    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 80));
    imagePreloadHandle = schedule(preloadQueuedImages, {timeout: 500});
}

function preloadQueuedImages() {
    imagePreloadHandle = 0;
    const batch = Array.from(queuedImagePreloads).slice(0, 8);
    for (const url of batch) {
        queuedImagePreloads.delete(url);
        preloadImage(url);
    }
    if (queuedImagePreloads.size) {
        queueImagePreload([]);
    }
}

function preloadImage(url) {
    if (!url || imagePreloadCache.has(url)) {
        return;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    imagePreloadCache.set(url, image);
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
                ${label ? `<span>${escapeHtml(label)}</span>` : ""}
            </div>
            <div class="actions">${actions}</div>
        </header>
    `;
}

function renderConfig() {
    const canStartGame = hasGameContent();
    app.innerHTML = `
        ${renderTopBar("", `
            ${renderStartGameControl(canStartGame)}
        `)}
        <main class="page">
            <div class="page-title">
                <h1>Wybór magów</h1>
            </div>
            <div class="config-controls">
                <button type="button" class="secondary" data-action="reset-side" data-side="PLAYER">Reset gracza</button>
                <button type="button" class="secondary" data-action="reset-side" data-side="OPPONENT">Reset przeciwnika</button>
            </div>
            ${renderConfigMessages()}
            <div class="duel-grid">
                ${SIDES.map((side) => renderConfigSide(side.id)).join("")}
            </div>
        </main>
        ${renderBoundModal()}
        ${renderCardPreviewModal()}
    `;
}

function renderStartGameControl(canStartGame) {
    const message = "Nie można rozpocząć gry bez maga albo Bound Spella.";
    return `
        <span class="start-game-control">
            <button type="button" class="warning" data-action="start-game" ${canStartGame ? "" : "disabled"}>Rozpocznij grę</button>
            ${canStartGame ? "" : `<span class="start-warning-icon" tabindex="0" title="${escapeAttr(message)}" aria-label="${escapeAttr(message)}">!</span>`}
        </span>
    `;
}

function renderConfigMessages() {
    const errors = (serverErrors || []).filter(shouldShowConfigMessage);
    const warnings = (serverWarnings || []).filter(shouldShowConfigMessage);
    if (!errors.length && !warnings.length) {
        return "";
    }
    return `
        <div class="config-messages">
            ${renderMessages(errors, "error")}
            ${renderMessages(warnings, "warning")}
        </div>
    `;
}

function shouldShowConfigMessage(message) {
    return !["empty-session", "mage-no-spells", "mage-spell-limit"].includes(message?.code);
}

function renderConfigSide(side) {
    const mages = magesForSide(side);
    const boundSpells = boundSpellEntriesForSide(side);
    const faction = factionForSide(side);
    return `
        <section class="side-column">
            <div class="side-heading">
                <div>
                    <h2>${escapeHtml(sideLabel(side))}</h2>
                    <span>${faction ? `${escapeHtml(faction.name)} · ` : ""}${mages.length} magów · ${boundSpells.length} Bound Spells</span>
                </div>
            </div>
            ${renderFactionPicker(side)}
            ${faction ? `
                ${renderAddMageForm(side)}
                ${mages.length ? mages.map(renderMagePanel).join("") : `<div class="empty-panel">Brak magów po tej stronie.</div>`}
                ${renderBoundSpellsSection(side)}
            ` : ""}
        </section>
    `;
}

function renderFactionPicker(side) {
    const selected = factionIdForSide(side);
    const faction = factionForSide(side);
    return `
        <section class="form-panel faction-panel">
            <div class="panel-title">
                <h2>Frakcja</h2>
            </div>
            <label>Armia
                ${factionSelect(side, selected)}
            </label>
        </section>
    `;
}

function renderAddMageForm(side) {
    const hasAvailableLores = availableLoresForSide(side, "mage").length > 0;
    const hasCasterPresets = casterPresetsForSide(side).length > 0;
    const canAddMage = hasAvailableLores && hasCasterPresets;
    return `
        <form class="form-panel" data-action="add-mage">
            <input type="hidden" name="side" value="${escapeAttr(normalizeSide(side))}">
            <div class="panel-title">
                <h2>Dodaj maga</h2>
            </div>
            ${hasAvailableLores ? "" : renderMessages([{message: "Ta frakcja nie ma dostępnych Lore w danych OWB dla zwykłych magów."}], "warning")}
            ${hasAvailableLores && !hasCasterPresets ? renderMessages([{message: "Brak predefiniowanych postaci maga dla tej frakcji."}], "warning") : ""}
            <div class="form-grid mage-add-grid">
                <label>Postać
                    ${casterPresetSelect(side, "", `name="casterPresetId" data-change="add-caster-preset" data-side="${escapeAttr(normalizeSide(side))}" required ${canAddMage ? "" : "disabled"}`)}
                </label>
                <label>Lvl
                    ${levelSelect("level", 1, canAddMage ? "" : "disabled")}
                </label>
                <label>Lore
                    ${loreSelect("loreId", "", "disabled", side, "mage")}
                </label>
                <button type="submit" ${canAddMage ? "" : "disabled"}>Dodaj</button>
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
    if (!factionIdForSide(side) || !preset || !isLoreAvailableForSide(side, loreId, "mage", casterPresetId)) {
        renderConfig();
        return;
    }
    session.mages.push({
        id: crypto.randomUUID(),
        side,
        casterPresetId,
        name: preset.name,
        note: "",
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
    const levelSelectElement = form.querySelector('select[name="level"]');
    const loreSelectElement = form.querySelector('select[name="loreId"]');
    if (preset && levelSelectElement) {
        levelSelectElement.value = String(preset.defaultLevel || 1);
    }
    if (loreSelectElement) {
        const lores = availableLoresForSide(side, "mage", preset?.id || "");
        loreSelectElement.innerHTML = loreOptionsHtml(lores, lores[0]?.id || "");
        loreSelectElement.disabled = !preset || lores.length === 0;
    }
}

function renderMagePanel(mage) {
    const selectedSpells = mage.spellIds.map((id) => spellsById.get(id)).filter(Boolean);
    const warnings = mageWarnings(mage);
    const preset = casterPresetForSide(mage.side, mage.casterPresetId);
    const needsSpells = selectedSpells.length === 0;
    return `
        <article class="mage-panel ${needsSpells ? "needs-spells" : ""}">
            <div class="panel-head">
                <div class="panel-title">
                    <h2>${escapeHtml(mage.name || "Mag")}</h2>
                    <span>Lvl ${mage.level} · ${mage.loreId ? escapeHtml(loreName(mage.loreId)) : "bez Lore"}${preset ? ` · ${escapeHtml(preset.name)}` : ""}</span>
                </div>
                <div class="actions">
                    <button type="button" class="secondary" data-action="choose-spells" data-mage-id="${escapeAttr(mage.id)}" ${mage.loreId ? "" : "disabled"}>Wybierz czary</button>
                    <button type="button" class="danger" data-action="delete-mage" data-mage-id="${escapeAttr(mage.id)}">Usuń</button>
                </div>
            </div>
            <div class="mage-edit-grid">
                <label>Postać
                    ${casterPresetSelect(mage.side, mage.casterPresetId, `data-change="mage-caster-preset" data-mage-id="${escapeAttr(mage.id)}"`)}
                </label>
                <label>Lvl
                    ${levelSelect("", mage.level, `data-change="mage-level" data-mage-id="${escapeAttr(mage.id)}"`)}
                </label>
                <label>Lore
                    ${loreSelect("", mage.loreId, `data-change="mage-lore" data-mage-id="${escapeAttr(mage.id)}"`, mage.side, "mage", mage.casterPresetId)}
                </label>
            </div>
            ${renderMessages(warnings, "warning")}
            <div>
                <div class="subsection-title">
                    <h3>Wybrane czary</h3>
                </div>
                <div class="chips">
                    ${selectedSpells.map((spell) => `<span class="chip">${escapeHtml(spell.spellName)}</span>`).join("")}
                </div>
            </div>
        </article>
    `;
}

async function updateMageField(target) {
    const mage = findMage(target.dataset.mageId);
    if (!mage) {
        return;
    }
    if (target.dataset.change === "mage-caster-preset") {
        const preset = casterPresetForSide(mage.side, target.value);
        if (!preset) {
            renderConfig();
            return;
        }
        mage.casterPresetId = preset.id;
        mage.name = preset.name;
        mage.level = preset.defaultLevel || mage.level;
        if (!preset.loreIds.includes(mage.loreId)) {
            mage.loreId = preset.loreIds[0] || "";
            mage.spellIds = [];
        }
    }
    if (target.dataset.change === "mage-level") {
        mage.level = Number(target.value);
    }
    if (target.dataset.change === "mage-lore") {
        mage.loreId = isLoreAvailableForSide(mage.side, target.value, "mage", mage.casterPresetId) ? target.value : "";
        mage.spellIds = [];
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

    app.innerHTML = `
        ${renderTopBar("", `
            <button type="button" class="secondary" data-action="cancel-spell-selection">Wróć</button>
        `)}
        <main class="page">
            <div class="selection-toolbar">
                <div class="panel-title">
                    <h2>${escapeHtml(lore?.name || "Lore")}</h2>
                    <span data-selection-count>${selectedCount} wybranych</span>
                </div>
                <div class="actions">
                    <button type="button" data-action="confirm-spell-selection">Zatwierdź wybór</button>
                </div>
            </div>
            ${renderMessages(warnings, "warning")}
            <div class="card-grid">
                ${(lore?.spells || []).map((spell) => renderSpellCard(spell, {
                    flipped: selectionDraft.spellIds.includes(spell.id),
                    selected: selectionDraft.spellIds.includes(spell.id),
                    action: "toggle-select-spell",
                    casterLevel: mage.level,
                    eager: true
                })).join("")}
            </div>
        </main>
        ${renderBoundModal()}
        ${renderCardPreviewModal()}
    `;
}

function toggleSelectedSpell(spellId, button = null) {
    if (!selectionDraft) {
        return;
    }
    const wasSelected = selectionDraft.spellIds.includes(spellId);
    if (wasSelected) {
        selectionDraft.spellIds = selectionDraft.spellIds.filter((id) => id !== spellId);
    } else {
        selectionDraft.spellIds.push(spellId);
    }
    const isSelected = !wasSelected;
    if (button) {
        updateSpellButtonFace(button, isSelected, "selected");
        updateSelectionCount();
    } else {
        renderSpellSelection(selectionDraft.mageId);
    }
}

function updateSelectionCount() {
    const count = document.querySelector("[data-selection-count]");
    if (count && selectionDraft) {
        const text = `${selectionDraft.spellIds.length} wybranych`;
        if (count.firstChild) {
            count.firstChild.nodeValue = text;
        } else {
            count.append(text);
        }
    }
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

function renderBoundSpellsSection(side) {
    const boundSpells = boundSpellEntriesForSide(side);
    const canAddBoundSpell = availableLoresForSide(side, "bound").length > 0;
    return `
        <section class="form-panel">
            <div class="subsection-title">
                <div class="panel-title">
                    <h2>Bound Spells</h2>
                </div>
                <button type="button" class="secondary" data-action="open-bound-editor" data-side="${escapeAttr(side)}" ${canAddBoundSpell ? "" : "disabled"}>Dodaj Bound Spell</button>
            </div>
            ${renderBoundList(boundSpells, side)}
        </section>
    `;
}

function renderBoundList(boundEntries, side = "PLAYER") {
    const entries = boundEntries || [];
    if (!entries.length) {
        return `<div class="empty-panel">Brak Bound Spells.</div>`;
    }
    return `
        <div class="bound-list">
            ${entries.map((entry) => {
                const boundSpell = entry.boundSpell;
                const spell = spellsById.get(boundSpell.spellId);
                const owner = entry.ownerName ? `${entry.ownerName} · ` : "";
                return `
                    <div class="bound-row">
                        <div>
                            <strong>${escapeHtml(boundSpell.name || "Bound Spell")}</strong>
                            <span>${escapeHtml(owner)}${escapeHtml(loreName(boundSpell.loreId))} · Lvl ${boundSpell.level} · ${escapeHtml(spell?.spellName || "bez czaru")}</span>
                        </div>
                        <div class="actions">
                            <button type="button" class="secondary" data-action="open-bound-editor" data-owner-mage-id="${escapeAttr(entry.ownerMageId)}" data-bound-id="${escapeAttr(boundSpell.id)}" data-side="${escapeAttr(side)}">Edytuj</button>
                            <button type="button" class="danger" data-action="delete-bound-spell" data-owner-mage-id="${escapeAttr(entry.ownerMageId)}" data-bound-id="${escapeAttr(boundSpell.id)}">Usuń</button>
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
        originalOwnerMageId: ownerMageId,
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

function chooseBoundSpell(spellId, button = null) {
    if (!boundEditor) {
        return;
    }
    const previousSpellId = boundEditor.draft.spellId;
    boundEditor.draft.spellId = spellId;
    boundEditor.error = "";
    if (!button) {
        renderCurrent();
        return;
    }

    if (previousSpellId && previousSpellId !== spellId) {
        const previousButton = Array.from(document.querySelectorAll(".bound-modal .spell-card"))
            .find((item) => item.dataset.spellId === previousSpellId);
        if (previousButton) {
            updateSpellButtonFace(previousButton, false, "selected");
        }
    }
    updateSpellButtonFace(button, true, "selected");
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
    const nextOwnerMageId = normalizeOwnerMageId(boundEditor.side, boundEditor.ownerMageId);
    const originalOwnerMageId = normalizeOwnerMageId(boundEditor.side, boundEditor.originalOwnerMageId);
    draft.side = nextOwnerMageId
        ? normalizeSide(findMage(nextOwnerMageId)?.side)
        : normalizeSide(boundEditor.side || draft.side);

    const originalList = originalOwnerMageId
        ? findMage(originalOwnerMageId)?.boundSpells
        : session.boundSpells;
    const list = nextOwnerMageId
        ? findMage(nextOwnerMageId)?.boundSpells
        : session.boundSpells;
    if (!originalList || !list) {
        return;
    }

    if (originalList !== list) {
        const originalIndex = originalList.findIndex((item) => item.id === draft.id);
        if (originalIndex >= 0) {
            originalList.splice(originalIndex, 1);
        }
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
    if (!confirm(`Zresetować stronę "${label}"?`)) {
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
            <section class="modal bound-modal">
                <div class="panel-head">
                    <div class="panel-title">
                        <h2>${boundEditor.boundId ? "Edytuj Bound Spell" : "Dodaj Bound Spell"}</h2>
                    </div>
                    <button type="button" class="secondary" data-action="close-bound-editor">Zamknij</button>
                </div>
                ${boundEditor.error ? renderMessages([{message: boundEditor.error}], "error") : ""}
                <div class="modal-grid">
                    <label>Źródło
                        ${boundSourceSelect(boundEditor.side, draft.sourceId || "")}
                    </label>
                    <label>Lvl
                        ${levelSelect("", draft.level, `data-change="bound-field" data-field="level"`)}
                    </label>
                    <label>Lore
                        ${loreSelect("", draft.loreId, `data-change="bound-field" data-field="loreId"`, boundEditor.side, "bound")}
                    </label>
                </div>
                <div class="card-grid modal-card-grid">
                    ${(lore?.spells || []).map((spell) => renderSpellCard(spell, {
                        flipped: draft.spellId === spell.id,
                        selected: draft.spellId === spell.id,
                        action: "choose-bound-spell",
                        casterLevel: draft.level,
                        casterKind: "bound",
                        eager: true
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
    if (!hasGameContent()) {
        renderConfig();
        return;
    }
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
        ${renderTopBar("", `
            <button type="button" class="secondary" data-action="back-to-config">Wybór magów</button>
            <button type="button" class="warning" data-action="end-turn">Zakończ turę</button>
        `)}
        <main class="page">
            <div class="duel-grid game-duel-grid">
                ${SIDES.map((side) => renderGameSide(side.id)).join("")}
            </div>
        </main>
        ${renderCardPreviewModal()}
    `;
}

function renderGameSide(side) {
    const mages = magesForSide(side);
    const boundSpells = boundSpellEntriesForSide(side);
    const faction = factionForSide(side);
    return `
        <section class="side-column game-side">
            <div class="side-heading">
                <div>
                    <h2>${escapeHtml(sideLabel(side))}</h2>
                    <span>${faction ? `${escapeHtml(faction.name)} · ` : ""}${mages.length} magów · ${boundSpells.length} Bound Spells</span>
                </div>
            </div>
            ${mages.length ? mages.map(renderMageGameSection).join("") : `<div class="empty-panel">Brak magów po tej stronie.</div>`}
            ${renderBoundGameSection(side)}
        </section>
    `;
}

function renderMageGameSection(mage) {
    const spells = mage.spellIds.map((id) => spellsById.get(id)).filter(Boolean);
    const needsSpells = spells.length === 0;
    return `
        <article class="game-section ${needsSpells ? "needs-spells" : ""}">
            <div class="panel-title">
                <h2>${escapeHtml(mage.name || "Mag")}</h2>
                <span>Lvl ${mage.level} · ${escapeHtml(loreName(mage.loreId))}</span>
            </div>
            <div class="subsection-title"><h3>Czary</h3></div>
            ${spells.length ? `<div class="card-grid">${spells.map((spell) => renderGameSpellCard(mage, spell)).join("")}</div>` : ""}
        </article>
    `;
}

function renderBoundGameSection(side) {
    const boundSpells = boundSpellEntriesForSide(side);
    return `
        <article class="game-section">
            <div class="panel-title">
                <h2>Bound Spells</h2>
            </div>
            ${boundSpells.length ? `<div class="card-grid">${boundSpells.map(renderGameBoundCard).join("")}</div>` : `<div class="empty-panel">Brak Bound Spells.</div>`}
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
        casterLevel: mage.level,
        eager: true
    });
}

function renderGameBoundCard(entry) {
    const boundSpell = entry.boundSpell || entry;
    const spell = spellsById.get(boundSpell.spellId);
    if (!spell) {
        return "";
    }
    const key = `bound:${boundSpell.id}`;
    const owner = entry.ownerName ? `${entry.ownerName} · ` : "";
    return `
        <div>
            <div class="bound-card-meta">
                <span class="chip bound bound-name" title="${escapeAttr(boundSpell.name || "Bound Spell")}">${escapeHtml(boundSpell.name || "Bound Spell")}</span>
                <span class="bound-level">${escapeHtml(owner)}Lvl ${boundSpell.level}</span>
            </div>
            ${renderSpellCard(spell, {
                flipped: session.usedCards.includes(key),
                used: session.usedCards.includes(key),
                action: "toggle-used-card",
                cardKey: key,
                casterLevel: boundSpell.level,
                casterKind: "bound",
                eager: true
            })}
        </div>
    `;
}

async function toggleUsedCard(cardKey, button = null) {
    if (button) {
        button.disabled = true;
    }
    try {
        const response = await api(`/api/sessions/${encodeURIComponent(session.id)}/used`, {
            method: "POST",
            body: JSON.stringify({key: cardKey})
        });
        applySessionResponse(response);
        updateUsedCardButton(cardKey, button);
    } finally {
        if (button && document.body.contains(button)) {
            button.disabled = false;
        }
    }
}

async function endTurn() {
    if (!confirm("Zakończyć turę i odwrócić wszystkie użyte karty awersem do góry?")) {
        return;
    }
    const response = await api(`/api/sessions/${encodeURIComponent(session.id)}/end-turn`, {method: "POST"});
    applySessionResponse(response);
    updateAllUsedCardButtons();
}

function updateUsedCardButton(cardKey, button = null) {
    const target = button?.dataset.cardKey === cardKey
        ? button
        : Array.from(document.querySelectorAll('[data-action="toggle-used-card"][data-card-key]'))
            .find((item) => item.dataset.cardKey === cardKey);
    if (!target) {
        renderGame();
        return;
    }
    updateSpellButtonFace(target, session.usedCards.includes(cardKey), "used");
}

function updateAllUsedCardButtons() {
    const buttons = document.querySelectorAll('[data-action="toggle-used-card"][data-card-key]');
    if (!buttons.length && session.mode === "GAME") {
        renderGame();
        return;
    }
    buttons.forEach((button) => updateSpellButtonFace(button, session.usedCards.includes(button.dataset.cardKey), "used"));
}

function updateSpellButtonFace(button, flipped, stateClass) {
    const spell = spellsById.get(button?.dataset.spellId);
    if (!button || !spell) {
        return;
    }
    queueSpellImagePreload(spell);
    button.classList.toggle(stateClass, flipped);
    const image = button.querySelector("img");
    const nextUrl = flipped ? spell.backUrl : spell.frontUrl;
    if (image && image.getAttribute("src") !== nextUrl) {
        image.src = nextUrl;
    }
}

function renderSpellCard(spell, options) {
    queueSpellImagePreload(spell);
    const imageUrl = options.flipped ? spell.backUrl : spell.frontUrl;
    const casterKind = options.casterKind || "wizard";
    const actualValue = actualCastingValue(spell.castingValue, options.casterLevel, casterKind);
    const loading = options.eager ? "eager" : "lazy";
    const fetchPriority = options.eager ? "high" : "auto";
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
                <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(spell.spellName)}" loading="${loading}" decoding="async" fetchpriority="${fetchPriority}">
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
    queueSpellImagePreload(spell);
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
                    <img class="card-preview-image" src="${escapeAttr(spell.frontUrl)}" alt="${escapeAttr(spell.spellName)}" loading="eager" decoding="async" fetchpriority="high">
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

function mageWarnings(mage) {
    const warnings = [];
    if (!mage.loreId) {
        warnings.push({message: "Ten mag nie ma wybranego Lore."});
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

function casterPresetSelect(side, selected = "", attrs = "") {
    const presets = casterPresetsForSide(side);
    return `
        <select ${attrs} ${presets.length ? "" : "disabled"}>
            <option value="">Wybierz postać</option>
            ${presets.map((preset) => `<option value="${escapeAttr(preset.id)}" ${selected === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("")}
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

function normalizeOwnerMageId(side, mageId) {
    const mage = findMage(mageId);
    return mage && normalizeSide(mage.side) === normalizeSide(side) ? mage.id : "";
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

function boundSpellEntriesForSide(side) {
    const normalizedSide = normalizeSide(side);
    const entries = boundSpellsForSide(normalizedSide).map((boundSpell) => ({
        boundSpell,
        ownerMageId: "",
        ownerName: ""
    }));
    for (const mage of magesForSide(normalizedSide)) {
        for (const boundSpell of mage.boundSpells || []) {
            entries.push({
                boundSpell,
                ownerMageId: mage.id,
                ownerName: mage.name || "Mag"
            });
        }
    }
    return entries;
}

function hasGameContent() {
    return session.mages.length > 0 || SIDES.some((side) => boundSpellEntriesForSide(side.id).length > 0);
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
