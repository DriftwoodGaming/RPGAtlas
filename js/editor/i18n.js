/* RPGAtlas - editor/i18n.js
   Editor-interface localization with persistent locale selection and English fallback.
   Phase 7 Stage C: dictionaries cover the full post-overhaul chrome (menus, command
   labels, dock panels, status templates, language dialog); tests-unit/i18n-parity.test.ts
   enforces that every chrome key exists in every locale and that no locale carries
   orphaned keys. Scope rule: editor CHROME only — labels, titles, buttons, tab names,
   status templates. Tooltips and modal body text fall back to English by design, and
   project content is never translated. */
"use strict";

export const EDITOR_LOCALE_STORAGE_KEY = "rpgatlas_editor_locale";

const SHARED = {
  es: {
    label: "Español",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "Mapas", "Tiles": "Mosaicos", "Autotiles": "Automosaicos", "Brush": "Pincel",
      "Import…": "Importar…", "(right-click map = pick)": "(clic derecho en el mapa = elegir)",
      "Ready": "Listo", "Zoom": "Zoom",
      "saved": "guardado", "unsaved": "sin guardar", "save failed": "error al guardar",
      "New map": "Nuevo mapa", "Delete map": "Eliminar mapa", "Generate random map": "Generar mapa aleatorio",
      // dock tab captions
      "Map": "Mapa", "HD-2D": "HD-2D", "World": "Mundo",
      // menus
      "File": "Archivo", "Edit": "Editar", "Mode": "Modo", "Draw": "Dibujar", "Layer": "Capa",
      "Scale": "Escala", "View": "Ver", "Tools": "Herramientas", "Game": "Juego", "Help": "Ayuda",
      // File
      "New Project…": "Nuevo proyecto…", "Open Project (.json)…": "Abrir proyecto (.json)…",
      "Save Project": "Guardar proyecto", "Export Project As File…": "Exportar proyecto como archivo…",
      "Export Standalone Game…": "Exportar juego independiente…", "Playtest": "Probar juego",
      // Game / map
      "Map Properties…": "Propiedades del mapa…", "HD-2D Viewport": "Visor HD-2D",
      "World View": "Vista del mundo", "Set Start Position…": "Definir posición inicial…",
      // Edit
      "Undo": "Deshacer", "Redo": "Rehacer", "Cut": "Cortar", "Copy": "Copiar", "Paste": "Pegar",
      "Clear Selection": "Limpiar selección",
      // modes
      "Map (Tile) Mode": "Modo mapa (mosaicos)", "Event Mode": "Modo eventos",
      "Passability Mode": "Modo transitabilidad", "Height Mode (HD-2D)": "Modo altura (HD-2D)",
      "Region Mode": "Modo regiones",
      // layers
      "Auto layer": "Capa automática", "Layer 1 (Ground)": "Capa 1 (Suelo)",
      "Layer 2 (Decor)": "Capa 2 (Decoración)", "Layer 3 (Decor 2)": "Capa 3 (Decoración 2)",
      "Layer 4 (Overhead)": "Capa 4 (Superior)",
      // tools
      "Pen": "Lápiz", "Eraser": "Borrador", "Rectangle": "Rectángulo", "Circle": "Círculo",
      "Fill": "Rellenar", "Shadow Pen": "Lápiz de sombras",
      // zoom
      "Zoom In": "Acercar", "Zoom Out": "Alejar", "Zoom 1:1": "Zoom 1:1",
      "Fit Map In View": "Ajustar mapa a la vista",
      // View menu / dock
      "Maps Panel": "Panel de mapas", "Tiles Panel": "Panel de mosaicos", "Focus Map": "Enfocar mapa",
      "Focus Next Panel": "Enfocar siguiente panel", "Reset Panel Layout": "Restablecer disposición",
      "Save Layout As…": "Guardar disposición como…", "Saved Layouts…": "Disposiciones guardadas…",
      // Tools menu
      "Database…": "Base de datos…", "Plugin Manager…": "Gestor de plugins…",
      "Audio Manager…": "Gestor de audio…", "Event Searcher…": "Buscador de eventos…",
      "Resource Manager…": "Gestor de recursos…", "Asset Browser…": "Explorador de assets…",
      "Character Generator…": "Generador de personajes…",
      "Import Autotile Sheet…": "Importar hoja de automosaicos…",
      "Command Palette…": "Paleta de comandos…",
      // Help menu
      "Interface Language…": "Idioma de la interfaz…", "Patch Notes": "Notas de versión",
      "Keyboard Shortcuts…": "Atajos de teclado…", "Quick Help": "Ayuda rápida",
      "About RPGAtlas": "Acerca de RPGAtlas",
      // language / appearance dialog
      "Interface Language": "Idioma de la interfaz", "Language": "Idioma",
      "UI Font Size": "Tamaño de letra de la interfaz",
      "Choose the language used by the editor. Project content is not translated.": "Elige el idioma del editor. El contenido del proyecto no se traduce.",
      // common buttons
      "Apply": "Aplicar", "Close": "Cerrar", "Cancel": "Cancelar", "Confirm": "Confirmar",
      "OK": "Aceptar", "Save": "Guardar", "Delete": "Eliminar",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "Modo eventos (doble clic = nuevo/editar, arrastrar = mover, clic derecho = menú)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "Transitabilidad (clic alterna auto → ✕ bloquear → ○ pasar → ⌒ cornisa)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Alturas — pintando {value} con {tool} (las teclas 0–9 cambian el valor, clic derecho lo elige y el borrador limpia)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "Regiones — pintando id {value} con {tool} (los dígitos fijan el id, -/= lo cambia, clic derecho lo elige y el borrador limpia)",
      "Click the map to set the start position": "Haz clic en el mapa para definir la posición inicial",
      "selection": "selección", "brush": "pincel", "passable": "transitable", "blocked": "bloqueado", "override": "anulación",
    },
  },
  fr: {
    label: "Français",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "Cartes", "Tiles": "Tuiles", "Autotiles": "Autotuiles", "Brush": "Pinceau",
      "Import…": "Importer…", "(right-click map = pick)": "(clic droit sur la carte = choisir)",
      "Ready": "Prêt", "Zoom": "Zoom",
      "saved": "enregistré", "unsaved": "non enregistré", "save failed": "échec de l'enregistrement",
      "New map": "Nouvelle carte", "Delete map": "Supprimer la carte", "Generate random map": "Générer une carte aléatoire",
      // dock tab captions
      "Map": "Carte", "HD-2D": "HD-2D", "World": "Monde",
      // menus
      "File": "Fichier", "Edit": "Édition", "Mode": "Mode", "Draw": "Dessin", "Layer": "Calque",
      "Scale": "Échelle", "View": "Affichage", "Tools": "Outils", "Game": "Jeu", "Help": "Aide",
      // File
      "New Project…": "Nouveau projet…", "Open Project (.json)…": "Ouvrir un projet (.json)…",
      "Save Project": "Enregistrer le projet", "Export Project As File…": "Exporter le projet…",
      "Export Standalone Game…": "Exporter le jeu autonome…", "Playtest": "Tester",
      // Game / map
      "Map Properties…": "Propriétés de la carte…", "HD-2D Viewport": "Fenêtre HD-2D",
      "World View": "Vue du monde", "Set Start Position…": "Définir la position initiale…",
      // Edit
      "Undo": "Annuler", "Redo": "Rétablir", "Cut": "Couper", "Copy": "Copier", "Paste": "Coller",
      "Clear Selection": "Effacer la sélection",
      // modes
      "Map (Tile) Mode": "Mode carte (tuiles)", "Event Mode": "Mode événements",
      "Passability Mode": "Mode praticabilité", "Height Mode (HD-2D)": "Mode hauteur (HD-2D)",
      "Region Mode": "Mode régions",
      // layers
      "Auto layer": "Calque automatique", "Layer 1 (Ground)": "Calque 1 (Sol)",
      "Layer 2 (Decor)": "Calque 2 (Décor)", "Layer 3 (Decor 2)": "Calque 3 (Décor 2)",
      "Layer 4 (Overhead)": "Calque 4 (Premier plan)",
      // tools
      "Pen": "Crayon", "Eraser": "Gomme", "Rectangle": "Rectangle", "Circle": "Cercle",
      "Fill": "Remplissage", "Shadow Pen": "Crayon d'ombre",
      // zoom
      "Zoom In": "Zoom avant", "Zoom Out": "Zoom arrière", "Zoom 1:1": "Zoom 1:1",
      "Fit Map In View": "Ajuster la carte à la vue",
      // View menu / dock
      "Maps Panel": "Panneau des cartes", "Tiles Panel": "Panneau des tuiles", "Focus Map": "Focus sur la carte",
      "Focus Next Panel": "Panneau suivant", "Reset Panel Layout": "Réinitialiser la disposition",
      "Save Layout As…": "Enregistrer la disposition sous…", "Saved Layouts…": "Dispositions enregistrées…",
      // Tools menu
      "Database…": "Base de données…", "Plugin Manager…": "Gestionnaire de plugins…",
      "Audio Manager…": "Gestionnaire audio…", "Event Searcher…": "Recherche d'événements…",
      "Resource Manager…": "Gestionnaire de ressources…", "Asset Browser…": "Explorateur d'assets…",
      "Character Generator…": "Générateur de personnages…",
      "Import Autotile Sheet…": "Importer une planche d'autotuiles…",
      "Command Palette…": "Palette de commandes…",
      // Help menu
      "Interface Language…": "Langue de l'interface…", "Patch Notes": "Notes de version",
      "Keyboard Shortcuts…": "Raccourcis clavier…", "Quick Help": "Aide rapide",
      "About RPGAtlas": "À propos de RPGAtlas",
      // language / appearance dialog
      "Interface Language": "Langue de l'interface", "Language": "Langue",
      "UI Font Size": "Taille de police de l'interface",
      "Choose the language used by the editor. Project content is not translated.": "Choisissez la langue de l'éditeur. Le contenu du projet n'est pas traduit.",
      // common buttons
      "Apply": "Appliquer", "Close": "Fermer", "Cancel": "Annuler", "Confirm": "Confirmation",
      "OK": "OK", "Save": "Enregistrer", "Delete": "Supprimer",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "Mode événements (double-clic = nouveau/modifier, glisser = déplacer, clic droit = menu)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "Praticabilité (clic alterne auto → ✕ bloqué → ○ libre → ⌒ corniche)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Hauteurs — peinture de {value} avec {tool} (les touches 0–9 règlent la valeur, clic droit la choisit et la gomme efface)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "Régions — peinture de l'id {value} avec {tool} (les chiffres fixent l'id, -/= le modifie, clic droit le choisit et la gomme efface)",
      "Click the map to set the start position": "Cliquez sur la carte pour définir la position initiale",
      "selection": "sélection", "brush": "pinceau", "passable": "praticable", "blocked": "bloqué", "override": "forçage",
    },
  },
  de: {
    label: "Deutsch",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "Karten", "Tiles": "Kacheln", "Autotiles": "Autokacheln", "Brush": "Pinsel",
      "Import…": "Importieren…", "(right-click map = pick)": "(Rechtsklick auf Karte = auswählen)",
      "Ready": "Bereit", "Zoom": "Zoom",
      "saved": "gespeichert", "unsaved": "ungespeichert", "save failed": "Speichern fehlgeschlagen",
      "New map": "Neue Karte", "Delete map": "Karte löschen", "Generate random map": "Zufallskarte erzeugen",
      // dock tab captions
      "Map": "Karte", "HD-2D": "HD-2D", "World": "Welt",
      // menus
      "File": "Datei", "Edit": "Bearbeiten", "Mode": "Modus", "Draw": "Zeichnen", "Layer": "Ebene",
      "Scale": "Maßstab", "View": "Ansicht", "Tools": "Werkzeuge", "Game": "Spiel", "Help": "Hilfe",
      // File
      "New Project…": "Neues Projekt…", "Open Project (.json)…": "Projekt öffnen (.json)…",
      "Save Project": "Projekt speichern", "Export Project As File…": "Projekt als Datei exportieren…",
      "Export Standalone Game…": "Eigenständiges Spiel exportieren…", "Playtest": "Testspielen",
      // Game / map
      "Map Properties…": "Karteneigenschaften…", "HD-2D Viewport": "HD-2D-Ansichtsfenster",
      "World View": "Weltansicht", "Set Start Position…": "Startposition festlegen…",
      // Edit
      "Undo": "Rückgängig", "Redo": "Wiederholen", "Cut": "Ausschneiden", "Copy": "Kopieren", "Paste": "Einfügen",
      "Clear Selection": "Auswahl aufheben",
      // modes
      "Map (Tile) Mode": "Kartenmodus (Kacheln)", "Event Mode": "Ereignismodus",
      "Passability Mode": "Passierbarkeitsmodus", "Height Mode (HD-2D)": "Höhenmodus (HD-2D)",
      "Region Mode": "Regionsmodus",
      // layers
      "Auto layer": "Automatische Ebene", "Layer 1 (Ground)": "Ebene 1 (Boden)",
      "Layer 2 (Decor)": "Ebene 2 (Dekor)", "Layer 3 (Decor 2)": "Ebene 3 (Dekor 2)",
      "Layer 4 (Overhead)": "Ebene 4 (Vordergrund)",
      // tools
      "Pen": "Stift", "Eraser": "Radierer", "Rectangle": "Rechteck", "Circle": "Kreis",
      "Fill": "Füllen", "Shadow Pen": "Schattenstift",
      // zoom
      "Zoom In": "Vergrößern", "Zoom Out": "Verkleinern", "Zoom 1:1": "Zoom 1:1",
      "Fit Map In View": "Karte einpassen",
      // View menu / dock
      "Maps Panel": "Kartenpanel", "Tiles Panel": "Kachelpanel", "Focus Map": "Karte fokussieren",
      "Focus Next Panel": "Nächstes Panel fokussieren", "Reset Panel Layout": "Panel-Layout zurücksetzen",
      "Save Layout As…": "Layout speichern unter…", "Saved Layouts…": "Gespeicherte Layouts…",
      // Tools menu
      "Database…": "Datenbank…", "Plugin Manager…": "Plugin-Manager…",
      "Audio Manager…": "Audio-Manager…", "Event Searcher…": "Ereignissuche…",
      "Resource Manager…": "Ressourcen-Manager…", "Asset Browser…": "Asset-Browser…",
      "Character Generator…": "Charaktergenerator…",
      "Import Autotile Sheet…": "Autokachel-Bogen importieren…",
      "Command Palette…": "Befehlspalette…",
      // Help menu
      "Interface Language…": "Oberflächensprache…", "Patch Notes": "Versionshinweise",
      "Keyboard Shortcuts…": "Tastenkürzel…", "Quick Help": "Kurzhilfe",
      "About RPGAtlas": "Über RPGAtlas",
      // language / appearance dialog
      "Interface Language": "Oberflächensprache", "Language": "Sprache",
      "UI Font Size": "Schriftgröße der Oberfläche",
      "Choose the language used by the editor. Project content is not translated.": "Wähle die Sprache des Editors. Projektinhalte werden nicht übersetzt.",
      // common buttons
      "Apply": "Anwenden", "Close": "Schließen", "Cancel": "Abbrechen", "Confirm": "Bestätigen",
      "OK": "OK", "Save": "Speichern", "Delete": "Löschen",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "Ereignismodus (Doppelklick = neu/bearbeiten, Ziehen = verschieben, Rechtsklick = Menü)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "Passierbarkeit (Klick wechselt auto → ✕ blockiert → ○ frei → ⌒ Vorsprung)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Höhen — {value} mit {tool} malen (Tasten 0–9 setzen den Wert, Rechtsklick übernimmt ihn, der Radierer löscht)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "Regionen — male Id {value} mit {tool} (Ziffern setzen die Id, -/= ändert sie, Rechtsklick übernimmt sie, der Radierer löscht)",
      "Click the map to set the start position": "Klicke auf die Karte, um die Startposition festzulegen",
      "selection": "Auswahl", "brush": "Pinsel", "passable": "passierbar", "blocked": "blockiert", "override": "Überschreibung",
    },
  },
};

/** Test hook (i18n-parity vitest): the non-English message tables. */
export const EDITOR_LOCALE_MESSAGES = SHARED;

const LOCALES = { en: { label: "English", messages: {} }, ...SHARED };

export function normalizeEditorLocale(locale) {
  const language = String(locale || "").trim().toLowerCase().replace("_", "-").split("-")[0];
  return Object.prototype.hasOwnProperty.call(LOCALES, language) ? language : "en";
}

export function createEditorI18n(options = {}) {
  const storage = options.storage || null;
  const documentRef = options.document || null;
  let storedLocale = "";
  try {
    storedLocale = storage ? storage.getItem(EDITOR_LOCALE_STORAGE_KEY) : "";
  } catch {
    storedLocale = "";
  }
  let locale = normalizeEditorLocale(storedLocale || options.browserLocale || "en");

  function t(key, values) {
    const source = String(key == null ? "" : key);
    const translated = LOCALES[locale].messages[source] || source;
    if (!values) return translated;
    return translated.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
  }

  function applyDocumentLanguage() {
    if (documentRef && documentRef.documentElement) documentRef.documentElement.lang = locale;
  }

  function setLocale(nextLocale) {
    locale = normalizeEditorLocale(nextLocale);
    try {
      if (storage) storage.setItem(EDITOR_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
    applyDocumentLanguage();
    return locale;
  }

  function localizeStatic(root = documentRef) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.title = t(element.getAttribute("data-i18n-title"));
    });
  }

  applyDocumentLanguage();
  return {
    get locale() { return locale; },
    locales: () => Object.entries(LOCALES).map(([id, pack]) => ({ id, label: pack.label })),
    localizeStatic,
    setLocale,
    t,
  };
}
