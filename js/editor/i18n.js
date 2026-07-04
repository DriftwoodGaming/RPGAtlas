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
      "Add sample map": "Añadir mapa de ejemplo",
      // dock tab captions
      "Map": "Mapa", "HD-2D": "HD-2D", "World": "Mundo", "Console": "Consola",
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
      "Console Panel": "Panel de consola",
      // Advanced Map Editor (Phase 8)
      "Advanced": "Avanzado", "Advanced Map Editor": "Editor de mapas avanzado",
      "Map Tree": "Árbol de mapas", "Layers": "Capas", "Events": "Eventos", "Collision": "Colisión",
      "New Folder…": "Nueva carpeta…", "Rename…": "Renombrar…", "Folder name": "Nombre de la carpeta",
      "Add Layer": "Añadir capa", "Add Group": "Añadir grupo", "Group Layer": "Agrupar capa", "Ungroup": "Desagrupar", "Move Up": "Subir", "Move Down": "Bajar", "Delete Layer": "Eliminar capa", "Layer name": "Nombre de la capa", "Group": "Grupo", "Toggle Visibility": "Alternar visibilidad", "Toggle Lock": "Alternar bloqueo", "Opacity": "Opacidad", "Blend": "Fusión", "Tint": "Tinte", "Clear Tint": "Quitar tinte", "Draw slot": "Franja de dibujo", "Below characters": "Debajo de los personajes", "Above (overhead)": "Encima (superior)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "Objetos", "New zone kind": "Nuevo tipo de zona", "Zones": "Zonas", "Zone name": "Nombre de la zona", "Name": "Nombre", "Kind": "Tipo", "Delete Zone": "Eliminar zona", "Encounter": "Encuentro", "Transfer": "Transporte", "Sound": "Sonido", "Weather": "Clima", "Spawn Point": "Punto de aparición", "Navigation": "Navegación", "Custom": "Personalizado", "Select / Edit": "Seleccionar / Editar", "Rectangle Zone": "Zona rectangular", "Ellipse Zone": "Zona elíptica", "Polygon Zone": "Zona poligonal", "Point Zone": "Zona de punto", "Encounter rate": "Frecuencia de encuentros", "Troops": "Grupos", "Test Encounter in This Area": "Probar encuentro en esta zona", "Destination": "Destino", "Facing": "Orientación", "Pick Destination": "Elegir destino", "Keep facing": "Mantener orientación", "Down": "Abajo", "Left": "Izquierda", "Right": "Derecha", "Up": "Arriba", "Audio key": "Clave de audio", "Volume": "Volumen", "Falloff": "Atenuación", "None": "Ninguna", "Linear (by distance)": "Lineal (por distancia)", "Power": "Intensidad",
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
      "Add sample map": "Ajouter une carte d'exemple",
      // dock tab captions
      "Map": "Carte", "HD-2D": "HD-2D", "World": "Monde", "Console": "Console",
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
      "Console Panel": "Panneau de console",
      // Advanced Map Editor (Phase 8)
      "Advanced": "Avancé", "Advanced Map Editor": "Éditeur de cartes avancé",
      "Map Tree": "Arborescence des cartes", "Layers": "Calques", "Events": "Événements", "Collision": "Collision",
      "New Folder…": "Nouveau dossier…", "Rename…": "Renommer…", "Folder name": "Nom du dossier",
      "Add Layer": "Ajouter un calque", "Add Group": "Ajouter un groupe", "Group Layer": "Grouper le calque", "Ungroup": "Dégrouper", "Move Up": "Monter", "Move Down": "Descendre", "Delete Layer": "Supprimer le calque", "Layer name": "Nom du calque", "Group": "Groupe", "Toggle Visibility": "Basculer la visibilité", "Toggle Lock": "Basculer le verrouillage", "Opacity": "Opacité", "Blend": "Fusion", "Tint": "Teinte", "Clear Tint": "Effacer la teinte", "Draw slot": "Position de dessin", "Below characters": "Sous les personnages", "Above (overhead)": "Au-dessus (surface)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "Objets", "New zone kind": "Nouveau type de zone", "Zones": "Zones", "Zone name": "Nom de la zone", "Name": "Nom", "Kind": "Type", "Delete Zone": "Supprimer la zone", "Encounter": "Rencontre", "Transfer": "Téléport", "Sound": "Son", "Weather": "Météo", "Spawn Point": "Point d’apparition", "Navigation": "Navigation", "Custom": "Personnalisé", "Select / Edit": "Sélectionner / Modifier", "Rectangle Zone": "Zone rectangulaire", "Ellipse Zone": "Zone elliptique", "Polygon Zone": "Zone polygonale", "Point Zone": "Zone ponctuelle", "Encounter rate": "Fréquence de rencontres", "Troops": "Groupes", "Test Encounter in This Area": "Tester une rencontre ici", "Destination": "Destination", "Facing": "Orientation", "Pick Destination": "Choisir la destination", "Keep facing": "Garder l’orientation", "Down": "Bas", "Left": "Gauche", "Right": "Droite", "Up": "Haut", "Audio key": "Clé audio", "Volume": "Volume", "Falloff": "Atténuation", "None": "Aucune", "Linear (by distance)": "Linéaire (par distance)", "Power": "Intensité",
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
      "Add sample map": "Beispielkarte hinzufügen",
      // dock tab captions
      "Map": "Karte", "HD-2D": "HD-2D", "World": "Welt", "Console": "Konsole",
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
      "Console Panel": "Konsolenpanel",
      // Advanced Map Editor (Phase 8)
      "Advanced": "Erweitert", "Advanced Map Editor": "Erweiterter Karteneditor",
      "Map Tree": "Kartenbaum", "Layers": "Ebenen", "Events": "Ereignisse", "Collision": "Kollision",
      "New Folder…": "Neuer Ordner…", "Rename…": "Umbenennen…", "Folder name": "Ordnername",
      "Add Layer": "Ebene hinzufügen", "Add Group": "Gruppe hinzufügen", "Group Layer": "Ebene gruppieren", "Ungroup": "Gruppierung aufheben", "Move Up": "Nach oben", "Move Down": "Nach unten", "Delete Layer": "Ebene löschen", "Layer name": "Ebenenname", "Group": "Gruppe", "Toggle Visibility": "Sichtbarkeit umschalten", "Toggle Lock": "Sperre umschalten", "Opacity": "Deckkraft", "Blend": "Mischmodus", "Tint": "Farbton", "Clear Tint": "Farbton entfernen", "Draw slot": "Zeichenebene", "Below characters": "Unter Figuren", "Above (overhead)": "Darüber (Overhead)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "Objekte", "New zone kind": "Neuer Zonentyp", "Zones": "Zonen", "Zone name": "Zonenname", "Name": "Name", "Kind": "Typ", "Delete Zone": "Zone löschen", "Encounter": "Zufallskampf", "Transfer": "Transfer", "Sound": "Klang", "Weather": "Wetter", "Spawn Point": "Erscheinungspunkt", "Navigation": "Navigation", "Custom": "Benutzerdefiniert", "Select / Edit": "Auswählen / Bearbeiten", "Rectangle Zone": "Rechteckzone", "Ellipse Zone": "Ellipsenzone", "Polygon Zone": "Polygonzone", "Point Zone": "Punktzone", "Encounter rate": "Kampfhäufigkeit", "Troops": "Gruppen", "Test Encounter in This Area": "Kampf in diesem Bereich testen", "Destination": "Ziel", "Facing": "Blickrichtung", "Pick Destination": "Ziel wählen", "Keep facing": "Blickrichtung behalten", "Down": "Unten", "Left": "Links", "Right": "Rechts", "Up": "Oben", "Audio key": "Audioschlüssel", "Volume": "Lautstärke", "Falloff": "Abschwächung", "None": "Keine", "Linear (by distance)": "Linear (nach Distanz)", "Power": "Stärke",
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
  ja: {
    label: "日本語",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "マップ", "Tiles": "タイル", "Autotiles": "オートタイル", "Brush": "ブラシ",
      "Import…": "インポート…", "(right-click map = pick)": "（マップを右クリック＝スポイト）",
      "Ready": "準備完了", "Zoom": "ズーム",
      "saved": "保存済み", "unsaved": "未保存", "save failed": "保存に失敗しました",
      "New map": "新しいマップ", "Delete map": "マップを削除", "Generate random map": "ランダムマップを生成",
      "Add sample map": "サンプルマップを追加",
      // dock tab captions
      "Map": "マップ", "HD-2D": "HD-2D", "World": "ワールド", "Console": "コンソール",
      // menus
      "File": "ファイル", "Edit": "編集", "Mode": "モード", "Draw": "描画", "Layer": "レイヤー",
      "Scale": "表示倍率", "View": "表示", "Tools": "ツール", "Game": "ゲーム", "Help": "ヘルプ",
      // File
      "New Project…": "新規プロジェクト…", "Open Project (.json)…": "プロジェクトを開く (.json)…",
      "Save Project": "プロジェクトを保存", "Export Project As File…": "プロジェクトをファイルに書き出す…",
      "Export Standalone Game…": "スタンドアロンゲームを書き出す…", "Playtest": "テストプレイ",
      // Game / map
      "Map Properties…": "マップの設定…", "HD-2D Viewport": "HD-2Dビューポート",
      "World View": "ワールドビュー", "Set Start Position…": "開始位置を設定…",
      // Edit
      "Undo": "元に戻す", "Redo": "やり直す", "Cut": "切り取り", "Copy": "コピー", "Paste": "貼り付け",
      "Clear Selection": "選択を解除",
      // modes
      "Map (Tile) Mode": "マップ（タイル）モード", "Event Mode": "イベントモード",
      "Passability Mode": "通行設定モード", "Height Mode (HD-2D)": "高さモード（HD-2D）",
      "Region Mode": "リージョンモード",
      // layers
      "Auto layer": "自動レイヤー", "Layer 1 (Ground)": "レイヤー1（地面）",
      "Layer 2 (Decor)": "レイヤー2（装飾）", "Layer 3 (Decor 2)": "レイヤー3（装飾2）",
      "Layer 4 (Overhead)": "レイヤー4（上層）",
      // tools
      "Pen": "ペン", "Eraser": "消しゴム", "Rectangle": "四角形", "Circle": "円",
      "Fill": "塗りつぶし", "Shadow Pen": "影ペン",
      // zoom
      "Zoom In": "拡大", "Zoom Out": "縮小", "Zoom 1:1": "ズーム1:1",
      "Fit Map In View": "マップを画面に合わせる",
      // View menu / dock
      "Maps Panel": "マップパネル", "Tiles Panel": "タイルパネル", "Focus Map": "マップにフォーカス",
      "Console Panel": "コンソールパネル",
      // Advanced Map Editor (Phase 8)
      "Advanced": "高度", "Advanced Map Editor": "高度なマップエディター",
      "Map Tree": "マップツリー", "Layers": "レイヤー", "Events": "イベント", "Collision": "コリジョン",
      "New Folder…": "新しいフォルダー…", "Rename…": "名前を変更…", "Folder name": "フォルダー名",
      "Add Layer": "レイヤーを追加", "Add Group": "グループを追加", "Group Layer": "レイヤーをグループ化", "Ungroup": "グループ解除", "Move Up": "上へ", "Move Down": "下へ", "Delete Layer": "レイヤーを削除", "Layer name": "レイヤー名", "Group": "グループ", "Toggle Visibility": "表示を切り替え", "Toggle Lock": "ロックを切り替え", "Opacity": "不透明度", "Blend": "合成モード", "Tint": "色合い", "Clear Tint": "色合いをクリア", "Draw slot": "描画スロット", "Below characters": "キャラクターの下", "Above (overhead)": "上（オーバーヘッド）",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "オブジェクト", "New zone kind": "新しいゾーン種別", "Zones": "ゾーン", "Zone name": "ゾーン名", "Name": "名前", "Kind": "種別", "Delete Zone": "ゾーンを削除", "Encounter": "エンカウント", "Transfer": "移動", "Sound": "サウンド", "Weather": "天候", "Spawn Point": "出現地点", "Navigation": "ナビゲーション", "Custom": "カスタム", "Select / Edit": "選択 / 編集", "Rectangle Zone": "矩形ゾーン", "Ellipse Zone": "楕円ゾーン", "Polygon Zone": "多角形ゾーン", "Point Zone": "点ゾーン", "Encounter rate": "エンカウント率", "Troops": "敵グループ", "Test Encounter in This Area": "このエリアでエンカウントをテスト", "Destination": "移動先", "Facing": "向き", "Pick Destination": "移動先を選ぶ", "Keep facing": "向きを維持", "Down": "下", "Left": "左", "Right": "右", "Up": "上", "Audio key": "音声キー", "Volume": "音量", "Falloff": "減衰", "None": "なし", "Linear (by distance)": "直線（距離による）", "Power": "強さ",
      "Focus Next Panel": "次のパネルにフォーカス", "Reset Panel Layout": "パネル配置をリセット",
      "Save Layout As…": "配置に名前を付けて保存…", "Saved Layouts…": "保存した配置…",
      // Tools menu
      "Database…": "データベース…", "Plugin Manager…": "プラグイン管理…",
      "Audio Manager…": "オーディオ管理…", "Event Searcher…": "イベント検索…",
      "Resource Manager…": "リソース管理…", "Asset Browser…": "アセットブラウザー…",
      "Character Generator…": "キャラクター生成…",
      "Import Autotile Sheet…": "オートタイルシートをインポート…",
      "Command Palette…": "コマンドパレット…",
      // Help menu
      "Interface Language…": "表示言語…", "Patch Notes": "更新履歴",
      "Keyboard Shortcuts…": "キーボードショートカット…", "Quick Help": "クイックヘルプ",
      "About RPGAtlas": "RPGAtlasについて",
      // language / appearance dialog
      "Interface Language": "表示言語", "Language": "言語",
      "UI Font Size": "UIの文字サイズ",
      "Choose the language used by the editor. Project content is not translated.": "エディターの表示言語を選択します。プロジェクトの内容は翻訳されません。",
      // common buttons
      "Apply": "適用", "Close": "閉じる", "Cancel": "キャンセル", "Confirm": "確認",
      "OK": "OK", "Save": "保存", "Delete": "削除",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "イベントモード（ダブルクリック＝新規/編集、ドラッグ＝移動、右クリック＝メニュー）",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "通行設定（クリックで 自動 → ✕ 通行不可 → ○ 通行可 → ⌒ 段差 を切り替え）",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "高さ — {tool}で{value}を描画中（0–9キーで値を設定、右クリックで取得、消しゴムで消去）",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "リージョン — {tool}でID {value} を描画中（数字キーでIDを設定、-/=で増減、右クリックで取得、消しゴムで消去）",
      "Click the map to set the start position": "マップをクリックして開始位置を設定",
      "selection": "選択範囲", "brush": "ブラシ", "passable": "通行可", "blocked": "通行不可", "override": "上書き",
    },
  },
  "zh-tw": {
    label: "繁體中文",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "地圖", "Tiles": "圖塊", "Autotiles": "自動圖塊", "Brush": "筆刷",
      "Import…": "匯入…", "(right-click map = pick)": "（右鍵點擊地圖＝拾取）",
      "Ready": "就緒", "Zoom": "縮放",
      "saved": "已儲存", "unsaved": "未儲存", "save failed": "儲存失敗",
      "New map": "新增地圖", "Delete map": "刪除地圖", "Generate random map": "產生隨機地圖",
      "Add sample map": "加入範例地圖",
      // dock tab captions
      "Map": "地圖", "HD-2D": "HD-2D", "World": "世界", "Console": "主控台",
      // menus
      "File": "檔案", "Edit": "編輯", "Mode": "模式", "Draw": "繪製", "Layer": "圖層",
      "Scale": "縮放比例", "View": "檢視", "Tools": "工具", "Game": "遊戲", "Help": "說明",
      // File
      "New Project…": "新增專案…", "Open Project (.json)…": "開啟專案 (.json)…",
      "Save Project": "儲存專案", "Export Project As File…": "匯出專案為檔案…",
      "Export Standalone Game…": "匯出獨立遊戲…", "Playtest": "試玩",
      // Game / map
      "Map Properties…": "地圖屬性…", "HD-2D Viewport": "HD-2D 檢視區",
      "World View": "世界檢視", "Set Start Position…": "設定起始位置…",
      // Edit
      "Undo": "復原", "Redo": "重做", "Cut": "剪下", "Copy": "複製", "Paste": "貼上",
      "Clear Selection": "清除選取範圍",
      // modes
      "Map (Tile) Mode": "地圖（圖塊）模式", "Event Mode": "事件模式",
      "Passability Mode": "通行模式", "Height Mode (HD-2D)": "高度模式（HD-2D）",
      "Region Mode": "區域模式",
      // layers
      "Auto layer": "自動圖層", "Layer 1 (Ground)": "圖層1（地面）",
      "Layer 2 (Decor)": "圖層2（裝飾）", "Layer 3 (Decor 2)": "圖層3（裝飾2）",
      "Layer 4 (Overhead)": "圖層4（上層）",
      // tools
      "Pen": "畫筆", "Eraser": "橡皮擦", "Rectangle": "矩形", "Circle": "圓形",
      "Fill": "填滿", "Shadow Pen": "陰影筆",
      // zoom
      "Zoom In": "放大", "Zoom Out": "縮小", "Zoom 1:1": "縮放1:1",
      "Fit Map In View": "地圖符合檢視",
      // View menu / dock
      "Maps Panel": "地圖面板", "Tiles Panel": "圖塊面板", "Focus Map": "聚焦地圖",
      "Console Panel": "主控台面板",
      // Advanced Map Editor (Phase 8)
      "Advanced": "進階", "Advanced Map Editor": "進階地圖編輯器",
      "Map Tree": "地圖樹", "Layers": "圖層", "Events": "事件", "Collision": "碰撞",
      "New Folder…": "新增資料夾…", "Rename…": "重新命名…", "Folder name": "資料夾名稱",
      "Add Layer": "新增圖層", "Add Group": "新增群組", "Group Layer": "群組化圖層", "Ungroup": "取消群組", "Move Up": "上移", "Move Down": "下移", "Delete Layer": "刪除圖層", "Layer name": "圖層名稱", "Group": "群組", "Toggle Visibility": "切換可見性", "Toggle Lock": "切換鎖定", "Opacity": "不透明度", "Blend": "混合模式", "Tint": "色調", "Clear Tint": "清除色調", "Draw slot": "繪製層級", "Below characters": "角色下方", "Above (overhead)": "上方（頂層）",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "物件", "New zone kind": "新區域類型", "Zones": "區域", "Zone name": "區域名稱", "Name": "名稱", "Kind": "類型", "Delete Zone": "刪除區域", "Encounter": "遭遇", "Transfer": "傳送", "Sound": "音效", "Weather": "天氣", "Spawn Point": "出現點", "Navigation": "導航", "Custom": "自訂", "Select / Edit": "選取 / 編輯", "Rectangle Zone": "矩形區域", "Ellipse Zone": "橢圓區域", "Polygon Zone": "多邊形區域", "Point Zone": "點區域", "Encounter rate": "遭遇頻率", "Troops": "敵群", "Test Encounter in This Area": "在此區域測試遭遇", "Destination": "目的地", "Facing": "朝向", "Pick Destination": "選擇目的地", "Keep facing": "保持朝向", "Down": "下", "Left": "左", "Right": "右", "Up": "上", "Audio key": "音效鍵", "Volume": "音量", "Falloff": "衰減", "None": "無", "Linear (by distance)": "線性（依距離）", "Power": "強度",
      "Focus Next Panel": "聚焦下一個面板", "Reset Panel Layout": "重設面板配置",
      "Save Layout As…": "另存配置…", "Saved Layouts…": "已儲存的配置…",
      // Tools menu
      "Database…": "資料庫…", "Plugin Manager…": "外掛管理器…",
      "Audio Manager…": "音訊管理器…", "Event Searcher…": "事件搜尋器…",
      "Resource Manager…": "資源管理器…", "Asset Browser…": "素材瀏覽器…",
      "Character Generator…": "角色產生器…",
      "Import Autotile Sheet…": "匯入自動圖塊表…",
      "Command Palette…": "命令面板…",
      // Help menu
      "Interface Language…": "介面語言…", "Patch Notes": "更新紀錄",
      "Keyboard Shortcuts…": "鍵盤快速鍵…", "Quick Help": "快速說明",
      "About RPGAtlas": "關於 RPGAtlas",
      // language / appearance dialog
      "Interface Language": "介面語言", "Language": "語言",
      "UI Font Size": "介面字體大小",
      "Choose the language used by the editor. Project content is not translated.": "選擇編輯器使用的語言。專案內容不會被翻譯。",
      // common buttons
      "Apply": "套用", "Close": "關閉", "Cancel": "取消", "Confirm": "確認",
      "OK": "確定", "Save": "儲存", "Delete": "刪除",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "事件模式（雙擊＝新增/編輯，拖曳＝移動，右鍵＝選單）",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "通行設定（點擊循環切換 自動 → ✕ 阻擋 → ○ 通行 → ⌒ 台階）",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "高度 — 正在用{tool}繪製 {value}（按 0–9 設定數值，右鍵拾取，橡皮擦清除）",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "區域 — 正在用{tool}繪製 ID {value}（數字鍵設定 ID，-/= 增減，右鍵拾取，橡皮擦清除）",
      "Click the map to set the start position": "點擊地圖以設定起始位置",
      "selection": "選取範圍", "brush": "筆刷", "passable": "可通行", "blocked": "阻擋", "override": "覆蓋",
    },
  },
  "zh-cn": {
    label: "简体中文",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "地图", "Tiles": "图块", "Autotiles": "自动图块", "Brush": "笔刷",
      "Import…": "导入…", "(right-click map = pick)": "（右键点击地图＝拾取）",
      "Ready": "就绪", "Zoom": "缩放",
      "saved": "已保存", "unsaved": "未保存", "save failed": "保存失败",
      "New map": "新建地图", "Delete map": "删除地图", "Generate random map": "生成随机地图",
      "Add sample map": "添加示例地图",
      // dock tab captions
      "Map": "地图", "HD-2D": "HD-2D", "World": "世界", "Console": "控制台",
      // menus
      "File": "文件", "Edit": "编辑", "Mode": "模式", "Draw": "绘制", "Layer": "图层",
      "Scale": "缩放比例", "View": "视图", "Tools": "工具", "Game": "游戏", "Help": "帮助",
      // File
      "New Project…": "新建项目…", "Open Project (.json)…": "打开项目 (.json)…",
      "Save Project": "保存项目", "Export Project As File…": "导出项目为文件…",
      "Export Standalone Game…": "导出独立游戏…", "Playtest": "试玩",
      // Game / map
      "Map Properties…": "地图属性…", "HD-2D Viewport": "HD-2D 视口",
      "World View": "世界视图", "Set Start Position…": "设置起始位置…",
      // Edit
      "Undo": "撤销", "Redo": "重做", "Cut": "剪切", "Copy": "复制", "Paste": "粘贴",
      "Clear Selection": "清除选区",
      // modes
      "Map (Tile) Mode": "地图（图块）模式", "Event Mode": "事件模式",
      "Passability Mode": "通行模式", "Height Mode (HD-2D)": "高度模式（HD-2D）",
      "Region Mode": "区域模式",
      // layers
      "Auto layer": "自动图层", "Layer 1 (Ground)": "图层1（地面）",
      "Layer 2 (Decor)": "图层2（装饰）", "Layer 3 (Decor 2)": "图层3（装饰2）",
      "Layer 4 (Overhead)": "图层4（上层）",
      // tools
      "Pen": "画笔", "Eraser": "橡皮擦", "Rectangle": "矩形", "Circle": "圆形",
      "Fill": "填充", "Shadow Pen": "阴影笔",
      // zoom
      "Zoom In": "放大", "Zoom Out": "缩小", "Zoom 1:1": "缩放1:1",
      "Fit Map In View": "地图适应视图",
      // View menu / dock
      "Maps Panel": "地图面板", "Tiles Panel": "图块面板", "Focus Map": "聚焦地图",
      "Console Panel": "控制台面板",
      // Advanced Map Editor (Phase 8)
      "Advanced": "高级", "Advanced Map Editor": "高级地图编辑器",
      "Map Tree": "地图树", "Layers": "图层", "Events": "事件", "Collision": "碰撞",
      "New Folder…": "新建文件夹…", "Rename…": "重命名…", "Folder name": "文件夹名称",
      "Add Layer": "新增图层", "Add Group": "新增分组", "Group Layer": "分组图层", "Ungroup": "取消分组", "Move Up": "上移", "Move Down": "下移", "Delete Layer": "删除图层", "Layer name": "图层名称", "Group": "分组", "Toggle Visibility": "切换可见性", "Toggle Lock": "切换锁定", "Opacity": "不透明度", "Blend": "混合模式", "Tint": "色调", "Clear Tint": "清除色调", "Draw slot": "绘制层级", "Below characters": "角色下方", "Above (overhead)": "上方（顶层）",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "物件", "New zone kind": "新区域类型", "Zones": "区域", "Zone name": "区域名称", "Name": "名称", "Kind": "类型", "Delete Zone": "删除区域", "Encounter": "遭遇", "Transfer": "传送", "Sound": "音效", "Weather": "天气", "Spawn Point": "出现点", "Navigation": "导航", "Custom": "自定义", "Select / Edit": "选择 / 编辑", "Rectangle Zone": "矩形区域", "Ellipse Zone": "椭圆区域", "Polygon Zone": "多边形区域", "Point Zone": "点区域", "Encounter rate": "遭遇频率", "Troops": "敌群", "Test Encounter in This Area": "在此区域测试遭遇", "Destination": "目的地", "Facing": "朝向", "Pick Destination": "选择目的地", "Keep facing": "保持朝向", "Down": "下", "Left": "左", "Right": "右", "Up": "上", "Audio key": "音效键", "Volume": "音量", "Falloff": "衰减", "None": "无", "Linear (by distance)": "线性（按距离）", "Power": "强度",
      "Focus Next Panel": "聚焦下一个面板", "Reset Panel Layout": "重置面板布局",
      "Save Layout As…": "布局另存为…", "Saved Layouts…": "已保存的布局…",
      // Tools menu
      "Database…": "数据库…", "Plugin Manager…": "插件管理器…",
      "Audio Manager…": "音频管理器…", "Event Searcher…": "事件搜索器…",
      "Resource Manager…": "资源管理器…", "Asset Browser…": "素材浏览器…",
      "Character Generator…": "角色生成器…",
      "Import Autotile Sheet…": "导入自动图块表…",
      "Command Palette…": "命令面板…",
      // Help menu
      "Interface Language…": "界面语言…", "Patch Notes": "更新日志",
      "Keyboard Shortcuts…": "键盘快捷键…", "Quick Help": "快速帮助",
      "About RPGAtlas": "关于 RPGAtlas",
      // language / appearance dialog
      "Interface Language": "界面语言", "Language": "语言",
      "UI Font Size": "界面字体大小",
      "Choose the language used by the editor. Project content is not translated.": "选择编辑器使用的语言。项目内容不会被翻译。",
      // common buttons
      "Apply": "应用", "Close": "关闭", "Cancel": "取消", "Confirm": "确认",
      "OK": "确定", "Save": "保存", "Delete": "删除",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "事件模式（双击＝新建/编辑，拖动＝移动，右键＝菜单）",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "通行设置（点击循环切换 自动 → ✕ 阻挡 → ○ 通行 → ⌒ 台阶）",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "高度 — 正在用{tool}绘制 {value}（按 0–9 设置数值，右键拾取，橡皮擦清除）",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "区域 — 正在用{tool}绘制 ID {value}（数字键设置 ID，-/= 增减，右键拾取，橡皮擦清除）",
      "Click the map to set the start position": "点击地图以设置起始位置",
      "selection": "选区", "brush": "笔刷", "passable": "可通行", "blocked": "阻挡", "override": "覆盖",
    },
  },
  pt: {
    label: "Português",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "Mapas", "Tiles": "Tiles", "Autotiles": "Autotiles", "Brush": "Pincel",
      "Import…": "Importar…", "(right-click map = pick)": "(clique direito no mapa = capturar)",
      "Ready": "Pronto", "Zoom": "Zoom",
      "saved": "salvo", "unsaved": "não salvo", "save failed": "falha ao salvar",
      "New map": "Novo mapa", "Delete map": "Excluir mapa", "Generate random map": "Gerar mapa aleatório",
      "Add sample map": "Adicionar mapa de exemplo",
      // dock tab captions
      "Map": "Mapa", "HD-2D": "HD-2D", "World": "Mundo", "Console": "Console",
      // menus
      "File": "Arquivo", "Edit": "Editar", "Mode": "Modo", "Draw": "Desenhar", "Layer": "Camada",
      "Scale": "Escala", "View": "Exibir", "Tools": "Ferramentas", "Game": "Jogo", "Help": "Ajuda",
      // File
      "New Project…": "Novo projeto…", "Open Project (.json)…": "Abrir projeto (.json)…",
      "Save Project": "Salvar projeto", "Export Project As File…": "Exportar projeto como arquivo…",
      "Export Standalone Game…": "Exportar jogo independente…", "Playtest": "Testar jogo",
      // Game / map
      "Map Properties…": "Propriedades do mapa…", "HD-2D Viewport": "Janela HD-2D",
      "World View": "Vista do mundo", "Set Start Position…": "Definir posição inicial…",
      // Edit
      "Undo": "Desfazer", "Redo": "Refazer", "Cut": "Recortar", "Copy": "Copiar", "Paste": "Colar",
      "Clear Selection": "Limpar seleção",
      // modes
      "Map (Tile) Mode": "Modo mapa (tiles)", "Event Mode": "Modo de eventos",
      "Passability Mode": "Modo de passabilidade", "Height Mode (HD-2D)": "Modo de altura (HD-2D)",
      "Region Mode": "Modo de regiões",
      // layers
      "Auto layer": "Camada automática", "Layer 1 (Ground)": "Camada 1 (Chão)",
      "Layer 2 (Decor)": "Camada 2 (Decoração)", "Layer 3 (Decor 2)": "Camada 3 (Decoração 2)",
      "Layer 4 (Overhead)": "Camada 4 (Superior)",
      // tools
      "Pen": "Lápis", "Eraser": "Borracha", "Rectangle": "Retângulo", "Circle": "Círculo",
      "Fill": "Preencher", "Shadow Pen": "Lápis de sombra",
      // zoom
      "Zoom In": "Ampliar", "Zoom Out": "Reduzir", "Zoom 1:1": "Zoom 1:1",
      "Fit Map In View": "Ajustar mapa à janela",
      // View menu / dock
      "Maps Panel": "Painel de mapas", "Tiles Panel": "Painel de tiles", "Focus Map": "Focar no mapa",
      "Console Panel": "Painel do console",
      // Advanced Map Editor (Phase 8)
      "Advanced": "Avançado", "Advanced Map Editor": "Editor de mapas avançado",
      "Map Tree": "Árvore de mapas", "Layers": "Camadas", "Events": "Eventos", "Collision": "Colisão",
      "New Folder…": "Nova pasta…", "Rename…": "Renomear…", "Folder name": "Nome da pasta",
      "Add Layer": "Adicionar camada", "Add Group": "Adicionar grupo", "Group Layer": "Agrupar camada", "Ungroup": "Desagrupar", "Move Up": "Mover para cima", "Move Down": "Mover para baixo", "Delete Layer": "Excluir camada", "Layer name": "Nome da camada", "Group": "Grupo", "Toggle Visibility": "Alternar visibilidade", "Toggle Lock": "Alternar bloqueio", "Opacity": "Opacidade", "Blend": "Mesclagem", "Tint": "Tonalidade", "Clear Tint": "Limpar tonalidade", "Draw slot": "Faixa de desenho", "Below characters": "Abaixo dos personagens", "Above (overhead)": "Acima (superior)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "Objetos", "New zone kind": "Novo tipo de zona", "Zones": "Zonas", "Zone name": "Nome da zona", "Name": "Nome", "Kind": "Tipo", "Delete Zone": "Excluir zona", "Encounter": "Encontro", "Transfer": "Transporte", "Sound": "Som", "Weather": "Clima", "Spawn Point": "Ponto de surgimento", "Navigation": "Navegação", "Custom": "Personalizado", "Select / Edit": "Selecionar / Editar", "Rectangle Zone": "Zona retangular", "Ellipse Zone": "Zona elíptica", "Polygon Zone": "Zona poligonal", "Point Zone": "Zona de ponto", "Encounter rate": "Frequência de encontros", "Troops": "Grupos", "Test Encounter in This Area": "Testar encontro nesta área", "Destination": "Destino", "Facing": "Direção", "Pick Destination": "Escolher destino", "Keep facing": "Manter direção", "Down": "Baixo", "Left": "Esquerda", "Right": "Direita", "Up": "Cima", "Audio key": "Chave de áudio", "Volume": "Volume", "Falloff": "Atenuação", "None": "Nenhuma", "Linear (by distance)": "Linear (por distância)", "Power": "Intensidade",
      "Focus Next Panel": "Focar no próximo painel", "Reset Panel Layout": "Redefinir disposição dos painéis",
      "Save Layout As…": "Salvar disposição como…", "Saved Layouts…": "Disposições salvas…",
      // Tools menu
      "Database…": "Banco de dados…", "Plugin Manager…": "Gerenciador de plugins…",
      "Audio Manager…": "Gerenciador de áudio…", "Event Searcher…": "Localizador de eventos…",
      "Resource Manager…": "Gerenciador de recursos…", "Asset Browser…": "Navegador de assets…",
      "Character Generator…": "Gerador de personagens…",
      "Import Autotile Sheet…": "Importar folha de autotiles…",
      "Command Palette…": "Paleta de comandos…",
      // Help menu
      "Interface Language…": "Idioma da interface…", "Patch Notes": "Notas de atualização",
      "Keyboard Shortcuts…": "Atalhos de teclado…", "Quick Help": "Ajuda rápida",
      "About RPGAtlas": "Sobre o RPGAtlas",
      // language / appearance dialog
      "Interface Language": "Idioma da interface", "Language": "Idioma",
      "UI Font Size": "Tamanho da fonte da interface",
      "Choose the language used by the editor. Project content is not translated.": "Escolha o idioma usado pelo editor. O conteúdo do projeto não é traduzido.",
      // common buttons
      "Apply": "Aplicar", "Close": "Fechar", "Cancel": "Cancelar", "Confirm": "Confirmar",
      "OK": "OK", "Save": "Salvar", "Delete": "Excluir",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "Modo de eventos (clique duplo = novo/editar, arrastar = mover, clique direito = menu)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "Passabilidade (o clique alterna auto → ✕ bloquear → ○ passar → ⌒ saliência)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Alturas — pintando {value} com {tool} (as teclas 0–9 definem o valor, clique direito captura, a borracha apaga)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "Regiões — pintando id {value} com {tool} (os dígitos definem o id, -/= o altera, clique direito captura, a borracha apaga)",
      "Click the map to set the start position": "Clique no mapa para definir a posição inicial",
      "selection": "seleção", "brush": "pincel", "passable": "passável", "blocked": "bloqueado", "override": "substituição",
    },
  },
  ko: {
    label: "한국어",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "맵", "Tiles": "타일", "Autotiles": "오토타일", "Brush": "브러시",
      "Import…": "가져오기…", "(right-click map = pick)": "(맵 우클릭 = 스포이트)",
      "Ready": "준비 완료", "Zoom": "확대/축소",
      "saved": "저장됨", "unsaved": "저장 안 됨", "save failed": "저장 실패",
      "New map": "새 맵", "Delete map": "맵 삭제", "Generate random map": "랜덤 맵 생성",
      "Add sample map": "샘플 맵 추가",
      // dock tab captions
      "Map": "맵", "HD-2D": "HD-2D", "World": "월드", "Console": "콘솔",
      // menus
      "File": "파일", "Edit": "편집", "Mode": "모드", "Draw": "그리기", "Layer": "레이어",
      "Scale": "배율", "View": "보기", "Tools": "도구", "Game": "게임", "Help": "도움말",
      // File
      "New Project…": "새 프로젝트…", "Open Project (.json)…": "프로젝트 열기 (.json)…",
      "Save Project": "프로젝트 저장", "Export Project As File…": "프로젝트를 파일로 내보내기…",
      "Export Standalone Game…": "독립 실행형 게임 내보내기…", "Playtest": "테스트 플레이",
      // Game / map
      "Map Properties…": "맵 속성…", "HD-2D Viewport": "HD-2D 뷰포트",
      "World View": "월드 뷰", "Set Start Position…": "시작 위치 설정…",
      // Edit
      "Undo": "실행 취소", "Redo": "다시 실행", "Cut": "잘라내기", "Copy": "복사", "Paste": "붙여넣기",
      "Clear Selection": "선택 해제",
      // modes
      "Map (Tile) Mode": "맵(타일) 모드", "Event Mode": "이벤트 모드",
      "Passability Mode": "통행 설정 모드", "Height Mode (HD-2D)": "높이 모드(HD-2D)",
      "Region Mode": "리전 모드",
      // layers
      "Auto layer": "자동 레이어", "Layer 1 (Ground)": "레이어 1(지면)",
      "Layer 2 (Decor)": "레이어 2(장식)", "Layer 3 (Decor 2)": "레이어 3(장식 2)",
      "Layer 4 (Overhead)": "레이어 4(상단)",
      // tools
      "Pen": "펜", "Eraser": "지우개", "Rectangle": "사각형", "Circle": "원",
      "Fill": "채우기", "Shadow Pen": "그림자 펜",
      // zoom
      "Zoom In": "확대", "Zoom Out": "축소", "Zoom 1:1": "확대/축소 1:1",
      "Fit Map In View": "맵을 화면에 맞추기",
      // View menu / dock
      "Maps Panel": "맵 패널", "Tiles Panel": "타일 패널", "Focus Map": "맵으로 포커스",
      "Console Panel": "콘솔 패널",
      // Advanced Map Editor (Phase 8)
      "Advanced": "고급", "Advanced Map Editor": "고급 맵 에디터",
      "Map Tree": "맵 트리", "Layers": "레이어", "Events": "이벤트", "Collision": "충돌",
      "New Folder…": "새 폴더…", "Rename…": "이름 바꾸기…", "Folder name": "폴더 이름",
      "Add Layer": "레이어 추가", "Add Group": "그룹 추가", "Group Layer": "레이어 그룹화", "Ungroup": "그룹 해제", "Move Up": "위로", "Move Down": "아래로", "Delete Layer": "레이어 삭제", "Layer name": "레이어 이름", "Group": "그룹", "Toggle Visibility": "표시 전환", "Toggle Lock": "잠금 전환", "Opacity": "불투명도", "Blend": "블렌드", "Tint": "색조", "Clear Tint": "색조 지우기", "Draw slot": "그리기 슬롯", "Below characters": "캐릭터 아래", "Above (overhead)": "위 (오버헤드)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "오브젝트", "New zone kind": "새 구역 종류", "Zones": "구역", "Zone name": "구역 이름", "Name": "이름", "Kind": "종류", "Delete Zone": "구역 삭제", "Encounter": "인카운트", "Transfer": "이동", "Sound": "사운드", "Weather": "날씨", "Spawn Point": "등장 지점", "Navigation": "내비게이션", "Custom": "사용자 지정", "Select / Edit": "선택 / 편집", "Rectangle Zone": "사각형 구역", "Ellipse Zone": "타원 구역", "Polygon Zone": "다각형 구역", "Point Zone": "점 구역", "Encounter rate": "인카운트 빈도", "Troops": "적 그룹", "Test Encounter in This Area": "이 영역에서 인카운트 테스트", "Destination": "목적지", "Facing": "방향", "Pick Destination": "목적지 선택", "Keep facing": "방향 유지", "Down": "아래", "Left": "왼쪽", "Right": "오른쪽", "Up": "위", "Audio key": "오디오 키", "Volume": "볼륨", "Falloff": "감쇠", "None": "없음", "Linear (by distance)": "선형(거리 기반)", "Power": "강도",
      "Focus Next Panel": "다음 패널로 포커스", "Reset Panel Layout": "패널 배치 초기화",
      "Save Layout As…": "배치를 다른 이름으로 저장…", "Saved Layouts…": "저장된 배치…",
      // Tools menu
      "Database…": "데이터베이스…", "Plugin Manager…": "플러그인 관리자…",
      "Audio Manager…": "오디오 관리자…", "Event Searcher…": "이벤트 검색…",
      "Resource Manager…": "리소스 관리자…", "Asset Browser…": "애셋 브라우저…",
      "Character Generator…": "캐릭터 생성기…",
      "Import Autotile Sheet…": "오토타일 시트 가져오기…",
      "Command Palette…": "명령 팔레트…",
      // Help menu
      "Interface Language…": "인터페이스 언어…", "Patch Notes": "패치 노트",
      "Keyboard Shortcuts…": "키보드 단축키…", "Quick Help": "빠른 도움말",
      "About RPGAtlas": "RPGAtlas 정보",
      // language / appearance dialog
      "Interface Language": "인터페이스 언어", "Language": "언어",
      "UI Font Size": "UI 글꼴 크기",
      "Choose the language used by the editor. Project content is not translated.": "에디터에서 사용할 언어를 선택하세요. 프로젝트 내용은 번역되지 않습니다.",
      // common buttons
      "Apply": "적용", "Close": "닫기", "Cancel": "취소", "Confirm": "확인",
      "OK": "확인", "Save": "저장", "Delete": "삭제",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "이벤트 모드 (더블 클릭 = 새로 만들기/편집, 드래그 = 이동, 우클릭 = 메뉴)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "통행 설정 (클릭 시 자동 → ✕ 차단 → ○ 통행 → ⌒ 턱 순환)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "높이 — {tool}(으)로 {value} 칠하는 중 (0–9 키로 값 설정, 우클릭으로 선택, 지우개로 지움)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "리전 — {tool}(으)로 ID {value} 칠하는 중 (숫자 키로 ID 설정, -/=로 증감, 우클릭으로 선택, 지우개로 지움)",
      "Click the map to set the start position": "맵을 클릭해 시작 위치를 설정하세요",
      "selection": "선택 영역", "brush": "브러시", "passable": "통행 가능", "blocked": "차단됨", "override": "재정의",
    },
  },
  it: {
    label: "Italiano",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "Mappe", "Tiles": "Tile", "Autotiles": "Autotile", "Brush": "Pennello",
      "Import…": "Importa…", "(right-click map = pick)": "(clic destro sulla mappa = preleva)",
      "Ready": "Pronto", "Zoom": "Zoom",
      "saved": "salvato", "unsaved": "non salvato", "save failed": "salvataggio non riuscito",
      "New map": "Nuova mappa", "Delete map": "Elimina mappa", "Generate random map": "Genera mappa casuale",
      "Add sample map": "Aggiungi mappa di esempio",
      // dock tab captions
      "Map": "Mappa", "HD-2D": "HD-2D", "World": "Mondo", "Console": "Console",
      // menus
      "File": "File", "Edit": "Modifica", "Mode": "Modalità", "Draw": "Disegno", "Layer": "Livello",
      "Scale": "Scala", "View": "Visualizza", "Tools": "Strumenti", "Game": "Gioco", "Help": "Aiuto",
      // File
      "New Project…": "Nuovo progetto…", "Open Project (.json)…": "Apri progetto (.json)…",
      "Save Project": "Salva progetto", "Export Project As File…": "Esporta progetto come file…",
      "Export Standalone Game…": "Esporta gioco autonomo…", "Playtest": "Prova di gioco",
      // Game / map
      "Map Properties…": "Proprietà della mappa…", "HD-2D Viewport": "Vista HD-2D",
      "World View": "Vista del mondo", "Set Start Position…": "Imposta posizione iniziale…",
      // Edit
      "Undo": "Annulla", "Redo": "Ripristina", "Cut": "Taglia", "Copy": "Copia", "Paste": "Incolla",
      "Clear Selection": "Cancella selezione",
      // modes
      "Map (Tile) Mode": "Modalità mappa (tile)", "Event Mode": "Modalità eventi",
      "Passability Mode": "Modalità transitabilità", "Height Mode (HD-2D)": "Modalità altezza (HD-2D)",
      "Region Mode": "Modalità regioni",
      // layers
      "Auto layer": "Livello automatico", "Layer 1 (Ground)": "Livello 1 (Terreno)",
      "Layer 2 (Decor)": "Livello 2 (Decorazioni)", "Layer 3 (Decor 2)": "Livello 3 (Decorazioni 2)",
      "Layer 4 (Overhead)": "Livello 4 (Sopraelevato)",
      // tools
      "Pen": "Penna", "Eraser": "Gomma", "Rectangle": "Rettangolo", "Circle": "Cerchio",
      "Fill": "Riempimento", "Shadow Pen": "Penna ombra",
      // zoom
      "Zoom In": "Ingrandisci", "Zoom Out": "Riduci", "Zoom 1:1": "Zoom 1:1",
      "Fit Map In View": "Adatta mappa alla vista",
      // View menu / dock
      "Maps Panel": "Pannello mappe", "Tiles Panel": "Pannello tile", "Focus Map": "Focus sulla mappa",
      "Console Panel": "Pannello console",
      // Advanced Map Editor (Phase 8)
      "Advanced": "Avanzato", "Advanced Map Editor": "Editor mappe avanzato",
      "Map Tree": "Albero delle mappe", "Layers": "Livelli", "Events": "Eventi", "Collision": "Collisione",
      "New Folder…": "Nuova cartella…", "Rename…": "Rinomina…", "Folder name": "Nome della cartella",
      "Add Layer": "Aggiungi livello", "Add Group": "Aggiungi gruppo", "Group Layer": "Raggruppa livello", "Ungroup": "Separa", "Move Up": "Sposta su", "Move Down": "Sposta giù", "Delete Layer": "Elimina livello", "Layer name": "Nome del livello", "Group": "Gruppo", "Toggle Visibility": "Attiva/disattiva visibilità", "Toggle Lock": "Attiva/disattiva blocco", "Opacity": "Opacità", "Blend": "Fusione", "Tint": "Tinta", "Clear Tint": "Rimuovi tinta", "Draw slot": "Fascia di disegno", "Below characters": "Sotto i personaggi", "Above (overhead)": "Sopra (in primo piano)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "Oggetti", "New zone kind": "Nuovo tipo di zona", "Zones": "Zone", "Zone name": "Nome della zona", "Name": "Nome", "Kind": "Tipo", "Delete Zone": "Elimina zona", "Encounter": "Incontro", "Transfer": "Trasferimento", "Sound": "Suono", "Weather": "Meteo", "Spawn Point": "Punto di comparsa", "Navigation": "Navigazione", "Custom": "Personalizzato", "Select / Edit": "Seleziona / Modifica", "Rectangle Zone": "Zona rettangolare", "Ellipse Zone": "Zona ellittica", "Polygon Zone": "Zona poligonale", "Point Zone": "Zona puntuale", "Encounter rate": "Frequenza incontri", "Troops": "Gruppi", "Test Encounter in This Area": "Prova incontro in quest’area", "Destination": "Destinazione", "Facing": "Orientamento", "Pick Destination": "Scegli destinazione", "Keep facing": "Mantieni orientamento", "Down": "Giù", "Left": "Sinistra", "Right": "Destra", "Up": "Su", "Audio key": "Chiave audio", "Volume": "Volume", "Falloff": "Attenuazione", "None": "Nessuna", "Linear (by distance)": "Lineare (per distanza)", "Power": "Potenza",
      "Focus Next Panel": "Focus sul pannello successivo", "Reset Panel Layout": "Ripristina disposizione pannelli",
      "Save Layout As…": "Salva disposizione come…", "Saved Layouts…": "Disposizioni salvate…",
      // Tools menu
      "Database…": "Database…", "Plugin Manager…": "Gestore plugin…",
      "Audio Manager…": "Gestore audio…", "Event Searcher…": "Ricerca eventi…",
      "Resource Manager…": "Gestore risorse…", "Asset Browser…": "Browser degli asset…",
      "Character Generator…": "Generatore di personaggi…",
      "Import Autotile Sheet…": "Importa foglio autotile…",
      "Command Palette…": "Palette dei comandi…",
      // Help menu
      "Interface Language…": "Lingua dell'interfaccia…", "Patch Notes": "Note di versione",
      "Keyboard Shortcuts…": "Scorciatoie da tastiera…", "Quick Help": "Guida rapida",
      "About RPGAtlas": "Informazioni su RPGAtlas",
      // language / appearance dialog
      "Interface Language": "Lingua dell'interfaccia", "Language": "Lingua",
      "UI Font Size": "Dimensione del carattere dell'interfaccia",
      "Choose the language used by the editor. Project content is not translated.": "Scegli la lingua dell'editor. Il contenuto del progetto non viene tradotto.",
      // common buttons
      "Apply": "Applica", "Close": "Chiudi", "Cancel": "Annulla", "Confirm": "Conferma",
      "OK": "OK", "Save": "Salva", "Delete": "Elimina",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "Modalità eventi (doppio clic = nuovo/modifica, trascina = sposta, clic destro = menu)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "Transitabilità (il clic alterna auto → ✕ blocca → ○ passa → ⌒ sporgenza)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Altezze — dipingendo {value} con {tool} (i tasti 0–9 impostano il valore, il clic destro lo preleva, la gomma cancella)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "Regioni — dipingendo id {value} con {tool} (le cifre impostano l'id, -/= lo cambia, il clic destro lo preleva, la gomma cancella)",
      "Click the map to set the start position": "Fai clic sulla mappa per impostare la posizione iniziale",
      "selection": "selezione", "brush": "pennello", "passable": "transitabile", "blocked": "bloccato", "override": "sostituzione",
    },
  },
  ru: {
    label: "Русский",
    messages: {
      // panels / static chrome (index.html data-i18n)
      "Maps": "Карты", "Tiles": "Тайлы", "Autotiles": "Автотайлы", "Brush": "Кисть",
      "Import…": "Импорт…", "(right-click map = pick)": "(ПКМ по карте = пипетка)",
      "Ready": "Готово", "Zoom": "Масштаб",
      "saved": "сохранено", "unsaved": "не сохранено", "save failed": "ошибка сохранения",
      "New map": "Новая карта", "Delete map": "Удалить карту", "Generate random map": "Создать случайную карту",
      "Add sample map": "Добавить образец карты",
      // dock tab captions
      "Map": "Карта", "HD-2D": "HD-2D", "World": "Мир", "Console": "Консоль",
      // menus
      "File": "Файл", "Edit": "Правка", "Mode": "Режим", "Draw": "Рисование", "Layer": "Слой",
      "Scale": "Масштаб", "View": "Вид", "Tools": "Инструменты", "Game": "Игра", "Help": "Справка",
      // File
      "New Project…": "Новый проект…", "Open Project (.json)…": "Открыть проект (.json)…",
      "Save Project": "Сохранить проект", "Export Project As File…": "Экспортировать проект в файл…",
      "Export Standalone Game…": "Экспортировать автономную игру…", "Playtest": "Тестовая игра",
      // Game / map
      "Map Properties…": "Свойства карты…", "HD-2D Viewport": "Окно HD-2D",
      "World View": "Вид мира", "Set Start Position…": "Задать стартовую позицию…",
      // Edit
      "Undo": "Отменить", "Redo": "Повторить", "Cut": "Вырезать", "Copy": "Копировать", "Paste": "Вставить",
      "Clear Selection": "Снять выделение",
      // modes
      "Map (Tile) Mode": "Режим карты (тайлы)", "Event Mode": "Режим событий",
      "Passability Mode": "Режим проходимости", "Height Mode (HD-2D)": "Режим высот (HD-2D)",
      "Region Mode": "Режим регионов",
      // layers
      "Auto layer": "Автослой", "Layer 1 (Ground)": "Слой 1 (Земля)",
      "Layer 2 (Decor)": "Слой 2 (Декор)", "Layer 3 (Decor 2)": "Слой 3 (Декор 2)",
      "Layer 4 (Overhead)": "Слой 4 (Верхний)",
      // tools
      "Pen": "Перо", "Eraser": "Ластик", "Rectangle": "Прямоугольник", "Circle": "Круг",
      "Fill": "Заливка", "Shadow Pen": "Перо теней",
      // zoom
      "Zoom In": "Приблизить", "Zoom Out": "Отдалить", "Zoom 1:1": "Масштаб 1:1",
      "Fit Map In View": "Вписать карту в окно",
      // View menu / dock
      "Maps Panel": "Панель карт", "Tiles Panel": "Панель тайлов", "Focus Map": "Фокус на карту",
      "Console Panel": "Панель консоли",
      // Advanced Map Editor (Phase 8)
      "Advanced": "Расширенный", "Advanced Map Editor": "Расширенный редактор карт",
      "Map Tree": "Дерево карт", "Layers": "Слои", "Events": "События", "Collision": "Коллизия",
      "New Folder…": "Новая папка…", "Rename…": "Переименовать…", "Folder name": "Имя папки",
      "Add Layer": "Добавить слой", "Add Group": "Добавить группу", "Group Layer": "Сгруппировать слой", "Ungroup": "Разгруппировать", "Move Up": "Вверх", "Move Down": "Вниз", "Delete Layer": "Удалить слой", "Layer name": "Имя слоя", "Group": "Группа", "Toggle Visibility": "Переключить видимость", "Toggle Lock": "Переключить блокировку", "Opacity": "Непрозрачность", "Blend": "Смешивание", "Tint": "Оттенок", "Clear Tint": "Очистить оттенок", "Draw slot": "Слой отрисовки", "Below characters": "Под персонажами", "Above (overhead)": "Над (сверху)",
      // Advanced Map Editor — Objects & gameplay zones (Phase 8 Stage D)
      "Objects": "Объекты", "New zone kind": "Новый тип зоны", "Zones": "Зоны", "Zone name": "Имя зоны", "Name": "Имя", "Kind": "Тип", "Delete Zone": "Удалить зону", "Encounter": "Столкновение", "Transfer": "Переход", "Sound": "Звук", "Weather": "Погода", "Spawn Point": "Точка появления", "Navigation": "Навигация", "Custom": "Пользовательский", "Select / Edit": "Выбрать / Изменить", "Rectangle Zone": "Прямоугольная зона", "Ellipse Zone": "Эллиптическая зона", "Polygon Zone": "Полигональная зона", "Point Zone": "Точечная зона", "Encounter rate": "Частота столкновений", "Troops": "Группы", "Test Encounter in This Area": "Проверить столкновение здесь", "Destination": "Назначение", "Facing": "Направление", "Pick Destination": "Выбрать назначение", "Keep facing": "Сохранить направление", "Down": "Вниз", "Left": "Влево", "Right": "Вправо", "Up": "Вверх", "Audio key": "Ключ аудио", "Volume": "Громкость", "Falloff": "Затухание", "None": "Нет", "Linear (by distance)": "Линейное (по расстоянию)", "Power": "Сила",
      "Focus Next Panel": "Фокус на следующую панель", "Reset Panel Layout": "Сбросить расположение панелей",
      "Save Layout As…": "Сохранить расположение как…", "Saved Layouts…": "Сохранённые расположения…",
      // Tools menu
      "Database…": "База данных…", "Plugin Manager…": "Менеджер плагинов…",
      "Audio Manager…": "Менеджер аудио…", "Event Searcher…": "Поиск событий…",
      "Resource Manager…": "Менеджер ресурсов…", "Asset Browser…": "Браузер ассетов…",
      "Character Generator…": "Генератор персонажей…",
      "Import Autotile Sheet…": "Импорт листа автотайлов…",
      "Command Palette…": "Палитра команд…",
      // Help menu
      "Interface Language…": "Язык интерфейса…", "Patch Notes": "Список изменений",
      "Keyboard Shortcuts…": "Горячие клавиши…", "Quick Help": "Краткая справка",
      "About RPGAtlas": "О программе RPGAtlas",
      // language / appearance dialog
      "Interface Language": "Язык интерфейса", "Language": "Язык",
      "UI Font Size": "Размер шрифта интерфейса",
      "Choose the language used by the editor. Project content is not translated.": "Выберите язык редактора. Содержимое проекта не переводится.",
      // common buttons
      "Apply": "Применить", "Close": "Закрыть", "Cancel": "Отмена", "Confirm": "Подтвердить",
      "OK": "OK", "Save": "Сохранить", "Delete": "Удалить",
      // status templates
      "Event mode (double-click = new/edit, drag = move, right-click = menu)": "Режим событий (двойной клик = создать/изменить, перетаскивание = переместить, ПКМ = меню)",
      "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)": "Проходимость (клик переключает авто → ✕ блок → ○ проход → ⌒ уступ)",
      "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)": "Высоты — рисуем {value} инструментом {tool} (клавиши 0–9 задают значение, ПКМ подбирает, ластик стирает)",
      "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)": "Регионы — рисуем id {value} инструментом {tool} (цифры задают id, -/= меняет его, ПКМ подбирает, ластик стирает)",
      "Click the map to set the start position": "Кликните по карте, чтобы задать стартовую позицию",
      "selection": "выделение", "brush": "кисть", "passable": "проходимо", "blocked": "заблокировано", "override": "переопределение",
    },
  },
};

/** Test hook (i18n-parity vitest): the non-English message tables. */
export const EDITOR_LOCALE_MESSAGES = SHARED;

const LOCALES = { en: { label: "English", messages: {} }, ...SHARED };

export function normalizeEditorLocale(locale) {
  const tag = String(locale || "").trim().toLowerCase().replace(/_/g, "-");
  if (Object.prototype.hasOwnProperty.call(LOCALES, tag)) return tag;
  const parts = tag.split("-");
  if (parts[0] === "zh") {
    // Chinese ships as two script packs, so the base language alone can't pick
    // one: Traditional-script tags (Hant script or TW/HK/MO regions) get zh-tw,
    // every other zh tag gets zh-cn.
    const traditional = parts.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo");
    return traditional ? "zh-tw" : "zh-cn";
  }
  return Object.prototype.hasOwnProperty.call(LOCALES, parts[0]) ? parts[0] : "en";
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
