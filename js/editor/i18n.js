/* RPGAtlas - editor/i18n.js
   Editor-interface localization with persistent locale selection and English fallback. */
"use strict";

export const EDITOR_LOCALE_STORAGE_KEY = "rpgatlas_editor_locale";

const SHARED = {
  es: {
    label: "Español",
    messages: {
      "Maps": "Mapas", "Tiles": "Mosaicos", "(right-click map = pick)": "(clic derecho en el mapa = elegir)",
      "Ready": "Listo", "saved": "guardado", "unsaved": "sin guardar", "save failed": "error al guardar",
      "New map": "Nuevo mapa", "Delete map": "Eliminar mapa", "Generate random map": "Generar mapa aleatorio",
      "File": "Archivo", "Edit": "Editar", "Mode": "Modo", "Draw": "Dibujar", "Layer": "Capa",
      "Scale": "Escala", "Tools": "Herramientas", "Game": "Juego", "Help": "Ayuda",
      "New Project…": "Nuevo proyecto…", "Open Project (.json)…": "Abrir proyecto (.json)…",
      "Save Project": "Guardar proyecto", "Export Project As File…": "Exportar proyecto como archivo…",
      "Export Standalone Game…": "Exportar juego independiente…", "Playtest": "Probar juego",
      "Map Properties…": "Propiedades del mapa…", "HD-2D Preview": "Vista previa HD-2D",
      "Undo": "Deshacer", "Redo": "Rehacer", "Cut": "Cortar", "Copy": "Copiar", "Paste": "Pegar",
      "Clear Selection": "Limpiar selección", "Map (Tile) Mode": "Modo mapa (mosaicos)",
      "Event Mode": "Modo eventos", "Passability Mode": "Modo transitabilidad",
      "Height Mode (HD-2D)": "Modo altura (HD-2D)", "Set Start Position…": "Definir posición inicial…",
      "Auto layer": "Capa automática", "Layer 1 (Ground)": "Capa 1 (Suelo)",
      "Layer 2 (Decor)": "Capa 2 (Decoración)", "Layer 3 (Decor 2)": "Capa 3 (Decoración 2)",
      "Layer 4 (Overhead)": "Capa 4 (Superior)", "Pen": "Lápiz", "Eraser": "Borrador",
      "Rectangle": "Rectángulo", "Circle": "Círculo", "Fill": "Rellenar", "Shadow Pen": "Lápiz de sombras",
      "Zoom In": "Acercar", "Zoom Out": "Alejar", "Fit Map In View": "Ajustar mapa a la vista",
      "Database…": "Base de datos…", "Plugin Manager…": "Gestor de plugins…",
      "Audio Manager…": "Gestor de audio…", "Event Searcher…": "Buscador de eventos…",
      "Resource Manager…": "Gestor de recursos…", "Character Generator…": "Generador de personajes…",
      "Interface Language…": "Idioma de la interfaz…", "Patch Notes": "Notas de versión",
      "Quick Help": "Ayuda rápida", "About RPGAtlas": "Acerca de RPGAtlas",
      "Interface Language": "Idioma de la interfaz", "Language": "Idioma", "Apply": "Aplicar",
      "Close": "Cerrar", "Cancel": "Cancelar", "Confirm": "Confirmar", "OK": "Aceptar",
      "Choose the language used by the editor. Project content is not translated.": "Elige el idioma del editor. El contenido del proyecto no se traduce.",
      "Event mode (double-click = new/edit, drag = move)": "Modo eventos (doble clic = nuevo/editar, arrastrar = mover)",
      "Passability (click cycles auto → ✕ block → ○ pass)": "Transitabilidad (clic alterna auto → ✕ bloquear → ○ pasar)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Alturas — pintando {value} con {tool} (las teclas 0–9 cambian el valor, clic derecho lo elige y el borrador limpia)",
      "Click the map to set the start position": "Haz clic en el mapa para definir la posición inicial",
      "selection": "selección", "brush": "pincel", "passable": "transitable", "blocked": "bloqueado", "override": "anulación",
    },
  },
  fr: {
    label: "Français",
    messages: {
      "Maps": "Cartes", "Tiles": "Tuiles", "(right-click map = pick)": "(clic droit sur la carte = choisir)",
      "Ready": "Prêt", "saved": "enregistré", "unsaved": "non enregistré", "save failed": "échec de l'enregistrement",
      "New map": "Nouvelle carte", "Delete map": "Supprimer la carte", "Generate random map": "Générer une carte aléatoire",
      "File": "Fichier", "Edit": "Édition", "Mode": "Mode", "Draw": "Dessin", "Layer": "Calque",
      "Scale": "Échelle", "Tools": "Outils", "Game": "Jeu", "Help": "Aide",
      "New Project…": "Nouveau projet…", "Open Project (.json)…": "Ouvrir un projet (.json)…",
      "Save Project": "Enregistrer le projet", "Export Project As File…": "Exporter le projet…",
      "Export Standalone Game…": "Exporter le jeu autonome…", "Playtest": "Tester",
      "Map Properties…": "Propriétés de la carte…", "HD-2D Preview": "Aperçu HD-2D",
      "Undo": "Annuler", "Redo": "Rétablir", "Cut": "Couper", "Copy": "Copier", "Paste": "Coller",
      "Clear Selection": "Effacer la sélection", "Map (Tile) Mode": "Mode carte (tuiles)",
      "Event Mode": "Mode événements", "Passability Mode": "Mode praticabilité",
      "Height Mode (HD-2D)": "Mode hauteur (HD-2D)", "Set Start Position…": "Définir la position initiale…",
      "Auto layer": "Calque automatique", "Layer 1 (Ground)": "Calque 1 (Sol)",
      "Layer 2 (Decor)": "Calque 2 (Décor)", "Layer 3 (Decor 2)": "Calque 3 (Décor 2)",
      "Layer 4 (Overhead)": "Calque 4 (Premier plan)", "Pen": "Crayon", "Eraser": "Gomme",
      "Rectangle": "Rectangle", "Circle": "Cercle", "Fill": "Remplissage", "Shadow Pen": "Crayon d'ombre",
      "Zoom In": "Zoom avant", "Zoom Out": "Zoom arrière", "Fit Map In View": "Ajuster la carte à la vue",
      "Database…": "Base de données…", "Plugin Manager…": "Gestionnaire de plugins…",
      "Audio Manager…": "Gestionnaire audio…", "Event Searcher…": "Recherche d'événements…",
      "Resource Manager…": "Gestionnaire de ressources…", "Character Generator…": "Générateur de personnages…",
      "Interface Language…": "Langue de l'interface…", "Patch Notes": "Notes de version",
      "Quick Help": "Aide rapide", "About RPGAtlas": "À propos de RPGAtlas",
      "Interface Language": "Langue de l'interface", "Language": "Langue", "Apply": "Appliquer",
      "Close": "Fermer", "Cancel": "Annuler", "Confirm": "Confirmation", "OK": "OK",
      "Choose the language used by the editor. Project content is not translated.": "Choisissez la langue de l'éditeur. Le contenu du projet n'est pas traduit.",
      "Event mode (double-click = new/edit, drag = move)": "Mode événements (double-clic = nouveau/modifier, glisser = déplacer)",
      "Passability (click cycles auto → ✕ block → ○ pass)": "Praticabilité (clic alterne auto → ✕ bloqué → ○ libre)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Hauteurs — peinture de {value} avec {tool} (les touches 0–9 règlent la valeur, clic droit la choisit et la gomme efface)",
      "Click the map to set the start position": "Cliquez sur la carte pour définir la position initiale",
      "selection": "sélection", "brush": "pinceau", "passable": "praticable", "blocked": "bloqué", "override": "forçage",
    },
  },
  de: {
    label: "Deutsch",
    messages: {
      "Maps": "Karten", "Tiles": "Kacheln", "(right-click map = pick)": "(Rechtsklick auf Karte = auswählen)",
      "Ready": "Bereit", "saved": "gespeichert", "unsaved": "ungespeichert", "save failed": "Speichern fehlgeschlagen",
      "New map": "Neue Karte", "Delete map": "Karte löschen", "Generate random map": "Zufallskarte erzeugen",
      "File": "Datei", "Edit": "Bearbeiten", "Mode": "Modus", "Draw": "Zeichnen", "Layer": "Ebene",
      "Scale": "Ansicht", "Tools": "Werkzeuge", "Game": "Spiel", "Help": "Hilfe",
      "New Project…": "Neues Projekt…", "Open Project (.json)…": "Projekt öffnen (.json)…",
      "Save Project": "Projekt speichern", "Export Project As File…": "Projekt als Datei exportieren…",
      "Export Standalone Game…": "Eigenständiges Spiel exportieren…", "Playtest": "Testspielen",
      "Map Properties…": "Karteneigenschaften…", "HD-2D Preview": "HD-2D-Vorschau",
      "Undo": "Rückgängig", "Redo": "Wiederholen", "Cut": "Ausschneiden", "Copy": "Kopieren", "Paste": "Einfügen",
      "Clear Selection": "Auswahl aufheben", "Map (Tile) Mode": "Kartenmodus (Kacheln)",
      "Event Mode": "Ereignismodus", "Passability Mode": "Passierbarkeitsmodus",
      "Height Mode (HD-2D)": "Höhenmodus (HD-2D)", "Set Start Position…": "Startposition festlegen…",
      "Auto layer": "Automatische Ebene", "Layer 1 (Ground)": "Ebene 1 (Boden)",
      "Layer 2 (Decor)": "Ebene 2 (Dekor)", "Layer 3 (Decor 2)": "Ebene 3 (Dekor 2)",
      "Layer 4 (Overhead)": "Ebene 4 (Vordergrund)", "Pen": "Stift", "Eraser": "Radierer",
      "Rectangle": "Rechteck", "Circle": "Kreis", "Fill": "Füllen", "Shadow Pen": "Schattenstift",
      "Zoom In": "Vergrößern", "Zoom Out": "Verkleinern", "Fit Map In View": "Karte einpassen",
      "Database…": "Datenbank…", "Plugin Manager…": "Plugin-Manager…",
      "Audio Manager…": "Audio-Manager…", "Event Searcher…": "Ereignissuche…",
      "Resource Manager…": "Ressourcen-Manager…", "Character Generator…": "Charaktergenerator…",
      "Interface Language…": "Oberflächensprache…", "Patch Notes": "Versionshinweise",
      "Quick Help": "Kurzhilfe", "About RPGAtlas": "Über RPGAtlas",
      "Interface Language": "Oberflächensprache", "Language": "Sprache", "Apply": "Anwenden",
      "Close": "Schließen", "Cancel": "Abbrechen", "Confirm": "Bestätigen", "OK": "OK",
      "Choose the language used by the editor. Project content is not translated.": "Wähle die Sprache des Editors. Projektinhalte werden nicht übersetzt.",
      "Event mode (double-click = new/edit, drag = move)": "Ereignismodus (Doppelklick = neu/bearbeiten, Ziehen = verschieben)",
      "Passability (click cycles auto → ✕ block → ○ pass)": "Passierbarkeit (Klick wechselt auto → ✕ blockiert → ○ frei)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Höhen — {value} mit {tool} malen (Tasten 0–9 setzen den Wert, Rechtsklick übernimmt ihn, der Radierer löscht)",
      "Click the map to set the start position": "Klicke auf die Karte, um die Startposition festzulegen",
      "selection": "Auswahl", "brush": "Pinsel", "passable": "passierbar", "blocked": "blockiert", "override": "Überschreibung",
    },
  },
};

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
