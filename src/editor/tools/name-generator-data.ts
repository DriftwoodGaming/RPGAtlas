/* RPGAtlas - Generator Hub data and combinatorial naming engine.
   Original word banks power editor-only creative tools; generated names are
   never written into a project unless the creator chooses to use them.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */

export type GeneratorStyle = "concise" | "evocative" | "legendary";

export interface GeneratorSubtype {
  id: string;
  label: string;
  words: string[];
}

export interface GeneratorDefinition {
  id: string;
  name: string;
  shortName: string;
  symbol: string;
  category: "Gear" | "Magic" | "People" | "Places" | "Adventure";
  description: string;
  typeLabel: string;
  types: GeneratorSubtype[];
  tones: Array<keyof typeof TONE_WORDS>;
  concepts: string[];
  materials: string[];
  titles: string[];
  hooks: string[];
  templates?: Partial<Record<GeneratorStyle, string[]>>;
}

export interface GeneratorOptions {
  subtype?: string;
  tone?: keyof typeof TONE_WORDS;
  style?: GeneratorStyle;
  worldWord?: string;
  alliteration?: boolean;
  prefixThe?: boolean;
}

export interface GeneratedName {
  name: string;
  hook: string;
}

const words = (value: string): string[] => value.split("|").map((word) => word.trim()).filter(Boolean);
const type = (id: string, label: string, value: string): GeneratorSubtype => ({ id, label, words: words(value) });

export const TONE_WORDS = {
  heroic: words("Radiant|Valiant|Golden|Noble|Daring|Triumphant|Stalwart|Gallant|Honored|Resolute|Brilliant|Lionhearted|Ascendant|Unbroken|Dawnlit|Crowned|Exalted|Steadfast|Victorious|Legendary|Sunward|Fearless|Righteous|Dauntless"),
  dark: words("Ashen|Bloodied|Cursed|Dread|Fallen|Grim|Hollow|Nightbound|Ravenous|Shadowed|Wicked|Blackened|Forsaken|Bleak|Silent|Veiled|Doomed|Cruel|Haunted|Ruined|Venomous|Pale|Twisted|Grieving"),
  mystical: words("Arcane|Astral|Dreaming|Eldritch|Enchanted|Ethereal|Fey|Hidden|Moonlit|Runic|Secret|Starborn|Veiled|Whispering|Ancient|Crystal|Prophetic|Shimmering|Timeless|Unseen|Mystic|Otherworldly|Silver|Wondrous"),
  rustic: words("Bramble|Copper|Dusty|Earthen|Gnarled|Hearthside|Humble|Ironwood|Mossy|Old|Rugged|Saltworn|Stonebound|Thorny|Weathered|Wild|Woodland|Amber|Autumn|Riverworn|Red|Green|Stout|Wandering"),
  cosmic: words("Celestial|Cometborn|Eclipsed|Galactic|Infinite|Nebular|Orbiting|Solar|Stellar|Voidtouched|Zenith|Gravity-Bound|Meteoric|Lunar|Prismatic|Quasar|Starless|Abyssal|Aurora|Planar|Radiant|Singular|Transcendent|Worldless"),
} as const;

const COMMON_TEMPLATES: Record<GeneratorStyle, string[]> = {
  concise: [
    "{adjective} {subject}", "{material} {subject}", "{concept} {subject}",
    "{proper} {subject}", "{adjective} {concept}",
  ],
  evocative: [
    "{subject} of {concept}", "{adjective} {subject} of {concept}",
    "{concept}'s {subject}", "{material} {subject} of {concept}",
    "{adjective} {material} {subject}",
  ],
  legendary: [
    "{proper}, {title}", "{proper}, the {adjective} {subject}",
    "{subject} of the {adjective} {concept}", "The {adjective} {subject}",
    "{proper}, {title} of {concept}",
  ],
};

const CHARACTER_TEMPLATES: Record<GeneratorStyle, string[]> = {
  concise: ["{proper}", "{proper} {subject}", "{proper} {proper2}", "{subject} {proper}", "{adjective} {subject}"],
  evocative: ["{proper} of {concept}", "{proper} {subject} of {concept}", "{proper}, {title}", "{proper} the {adjective}", "{proper} {proper2}, {subject}"],
  legendary: ["{proper}, {title} of {concept}", "{proper} {proper2}, the {adjective} {subject}", "The {adjective} {subject}", "{proper}, {title}", "{proper} of the {adjective} {concept}"],
};

const CURRENCY_TEMPLATES: Record<GeneratorStyle, string[]> = {
  concise: ["{proper}", "{proper} {subject}", "{adjective} {subject}", "{material} {subject}", "{concept} {subject}"],
  evocative: ["{proper} {subject}", "{adjective} {material} {subject}", "{subject} of {concept}", "{concept} {subject}", "{proper} of {concept}"],
  legendary: ["Imperial {proper}", "Royal {material} {subject}", "{proper}, {subject} of {concept}", "The {adjective} {subject}", "{proper} {subject} Standard"],
};

const BOOK_TEMPLATES: Record<GeneratorStyle, string[]> = {
  concise: ["The {adjective} {subject}", "{concept} {subject}", "{proper}'s {subject}", "{material} {subject}", "{subject} of {concept}"],
  evocative: ["{subject} of {concept}", "The {adjective} {subject} of {concept}", "{proper}'s {material} {subject}", "On {concept} and {proper}", "{concept}: A {subject}"],
  legendary: ["{proper}, {title}", "The {subject} of the {adjective} {concept}", "{proper}'s {subject} of {concept}", "The {adjective} {material} {subject}", "{concept}, {title}"],
};

export const GENERATOR_DEFINITIONS: GeneratorDefinition[] = [
  {
    id: "weapon", name: "Weapon Name Generator", shortName: "Weapon", symbol: "⚔", category: "Gear",
    description: "Name blades, bows, hammers, staves, firearms, and stranger instruments of war.", typeLabel: "Weapon family",
    types: [
      type("blades", "Blades", "Sword|Sabre|Scimitar|Rapier|Longblade|Falchion|Dagger|Kris|Claymore|Katana"),
      type("hafted", "Hafted", "Axe|Greataxe|Hammer|Maul|Mace|Flail|Halberd|Glaive|Poleaxe|War Pick"),
      type("ranged", "Ranged", "Longbow|Shortbow|Crossbow|Arbalest|Sling|Rifle|Pistol|Hand Cannon|Javelin|Chakram"),
      type("arcane", "Arcane", "Staff|Wand|Scepter|Spellblade|Grimoire|Orb|Focus|Rod|Runeblade|Spirit Claw"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Dawn|Embers|Kings|Mercy|Storms|Winter|Vengeance|Oaths|Dragons|Silence|Stars|Ruin|Justice|Whispers|Giants|Fate|Thunder|Exiles|Victory|Shadows|Tides|Cinders|Memory|Eternity"),
    materials: words("Adamant|Blacksteel|Bronze|Cold Iron|Crystal|Dragonbone|Ebony|Ironwood|Mithril|Obsidian|Orichalcum|Silver|Star-metal|Steel|Sunstone|Volcanic Glass|Moonstone|Gold"),
    titles: words("Edge of Reckoning|Last Argument|Oathkeeper|Breaker of Sieges|Hand of the Regent|Dragon's Answer|Duelist's Promise|End of Tyrants|Voice of Thunder|Warden's Last Resort|Champion's Burden|Scourge of Cowards|Hunter of Wyrms|Keeper of the Line|Victory Made Steel|Herald of Ruin"),
    hooks: words("Forged after the Battle of {concept}.|Its bearer hears {concept} whenever danger nears.|The {material} surface remembers every duel.|A lost champion hid its final technique in the hilt.|It refuses to strike anyone who speaks its true name.|The weapon grows warm near servants of {concept}."),
  },
  {
    id: "armor", name: "Armor Name Generator", shortName: "Armor", symbol: "⬟", category: "Gear",
    description: "Create memorable names for full suits, shields, helms, cloaks, boots, and enchanted protection.", typeLabel: "Armor piece",
    types: [
      type("body", "Body armor", "Cuirass|Breastplate|Hauberk|Brigandine|Carapace|Mail|Plate|Jerkin|Vestment|Harness"),
      type("head", "Helms", "Helm|Greathelm|Crown|Mask|Visor|Hood|Circlet|Coif|War Hat|Faceguard"),
      type("shield", "Shields", "Shield|Buckler|Kite Shield|Tower Shield|Aegis|Wardplate|Targe|Pavise|Spellguard|Bulwark"),
      type("wearable", "Wearables", "Cloak|Mantle|Gauntlets|Greaves|Boots|Bracers|Pauldrons|Belt|Cape|Sabatons"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Fortitude|Dawn|Ancestors|Thorns|Warding|Night|Kings|Pilgrims|Storms|Embers|Truth|Martyrs|Dragons|Winter|Vigilance|Defiance|Mountains|Saints|Moonlight|Iron|Shelter|Resolve|Silence|Stars"),
    materials: words("Adamant|Basilisk Scale|Black Iron|Bronze|Cloudsteel|Dragonhide|Dwarven Steel|Ebony|Glass|Ironwood|Moon-silver|Obsidian|Runed Steel|Starmetal|Sun-brass|Wyvern Leather|Gold|Crystal"),
    titles: words("Wall Against Night|Keeper of the Last Gate|Shelter of Kings|Unbroken Promise|Bastion of Dawn|Dragon's Rebuke|Guardian of Pilgrims|Citadel Worn|Last Watch|Refusal of Death|Saint's Embrace|Fortress of One|Oath Made Visible|Bulwark of the Free|Ward of Ages|Shield of the Innocent"),
    hooks: words("A hairline rune glows whenever it turns a killing blow.|The inner lining bears the names of its former guardians.|It was hammered from the fallen gate of {concept}.|No rain touches the wearer while the armor is whole.|It becomes impossibly heavy in the hands of a coward.|The armor carries a sealed command from an ancient monarch."),
  },
  {
    id: "spell", name: "Spell Name Generator", shortName: "Spell", symbol: "✦", category: "Magic",
    description: "Conjure names for elemental attacks, wards, curses, healing rites, summons, and cosmic magic.", typeLabel: "Spell school",
    types: [
      type("elemental", "Elemental", "Bolt|Flare|Torrent|Quake|Blizzard|Tempest|Inferno|Lance|Wave|Nova"),
      type("ward", "Wards & healing", "Ward|Aegis|Mending|Renewal|Sanctuary|Barrier|Grace|Purification|Restoration|Benediction"),
      type("curse", "Curses", "Hex|Curse|Blight|Doom|Withering|Torment|Shackle|Malison|Brand|Bane"),
      type("summon", "Summoning", "Invocation|Conjuration|Calling|Gate|Pact|Manifestation|Awakening|Binding|Beacon|Descent"),
    ],
    tones: ["heroic", "dark", "mystical", "cosmic"],
    concepts: words("Flame|Frost|Thunder|Tides|Roots|Light|Shadows|Dreams|Time|Gravity|Spirits|Blood|Stars|Silence|Memory|Mirrors|Ash|Venom|Mercy|Judgment|Storms|Void|Crystal|Renewal"),
    materials: words("Amber|Azure|Crimson|Crystal|Emerald|Golden|Ivory|Obsidian|Onyx|Opaline|Prismatic|Runic|Sapphire|Scarlet|Silver|Umbral|Verdant|Violet"),
    titles: words("Final Theorem|Archmage's Answer|Rite of Seven Stars|Unmaking Word|Merciful Cataclysm|Forbidden Equation|Crown of Sorcery|Last Light|Secret of the First Flame|Astral Verdict|Dreamer's Escape|Saint's Reprieve|Law of the Void|Grand Transmutation|World-Splitting Canticle|Perfect Invocation"),
    hooks: words("The caster traces a {material} sigil before the effect erupts.|It was discovered in a dream shared by seven apprentices.|The spell grows stronger when cast in defense of another.|Its final syllable was erased from every royal archive.|Casting it briefly reveals the nearest path to {concept}.|A failed version still haunts the tower where it was invented."),
  },
  {
    id: "currency", name: "Currency Name Generator", shortName: "Currency", symbol: "◈", category: "Adventure",
    description: "Mint believable coins, notes, trade bars, magical tender, and underworld scrip for a setting.", typeLabel: "Currency form",
    types: [
      type("coin", "Coins", "Crown|Mark|Sovereign|Penny|Guilder|Ducat|Stater|Florin|Taler|Denar"),
      type("token", "Tokens", "Token|Chit|Seal|Shard|Scale|Ring|Disk|Bead|Chip|Tally"),
      type("note", "Notes", "Note|Bill|Script|Bond|Writ|Leaf|Ledger|Promise|Voucher|Draft"),
      type("arcane", "Arcane tender", "Spark|Gleam|Echo|Whisper|Memory|Favor|Breath|Rune|Charge|Oath"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Empire|Guilds|Moon|Sun|Harbors|Ash|Dragons|Saints|Coalition|Reaches|Crown|Free Cities|Deep Roads|Pilgrims|Stars|Tides|Orchards|Iron|Merchants|Rebellion|Concord|Frontier|Temple|Thrones"),
    materials: words("Amber|Brass|Bronze|Copper|Crystal|Electrum|Glass|Gold|Iron|Ivory|Jade|Obsidian|Paper|Pearl|Platinum|Silver|Steel|Tin"),
    titles: words("Standard of the Realm|Accepted at Every Gate|Measure of Honest Trade|Coin of the Compact|Promise of the Treasury|Seal of the Free Cities|Weight of the Crown|Merchant's Measure|Tender of the Deep Roads|Pilgrim's Due|Wage of Heroes|Token of Accord|Mark of the Frontier|Imperial Standard|Guild Reserve|Coin of Passage"),
    hooks: words("One {subject} buys a hot meal in most border towns.|Counterfeits are tested by whispering the name of {concept}.|The mint changes its {material} edge every winter.|Merchants bite the coin to reveal a hidden guild rune.|It is legal tender only while the current monarch lives.|A black-market exchange values it for the memory sealed inside."),
    templates: CURRENCY_TEMPLATES,
  },
  {
    id: "item", name: "Item Name Generator", shortName: "Item", symbol: "◆", category: "Gear",
    description: "Name common treasures, adventuring tools, jewelry, keys, charms, and curious quest objects.", typeLabel: "Item kind",
    types: [
      type("tool", "Tools", "Lantern|Compass|Key|Mirror|Needle|Chisel|Spyglass|Bell|Hourglass|Lockpick"),
      type("jewelry", "Jewelry", "Ring|Amulet|Brooch|Bracelet|Locket|Pendant|Tiara|Earring|Torc|Signet"),
      type("relic", "Relics", "Idol|Statuette|Urn|Tablet|Seal|Reliquary|Chalice|Censer|Icon|Fragment"),
      type("curio", "Curios", "Box|Bottle|Feather|Stone|Coin|Mask|Thread|Deck|Lens|Music Box"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic"],
    concepts: words("Lost Roads|Fortune|Secrets|Sleep|Kings|Tides|Whispers|Homecoming|Memory|Moonlight|Thieves|Pilgrims|Truth|Mending|Embers|Promises|Storms|Dreams|Passage|Ancestors|Hunger|Silence|Dawn|Shadows"),
    materials: words("Amber|Bone|Brass|Bronze|Copper|Crystal|Ebony|Glass|Gold|Iron|Ivory|Jade|Leather|Moonstone|Obsidian|Pearl|Silver|Wood"),
    titles: words("Last Keepsake|Key to Nowhere|Traveler's Companion|Secret-Bearer|Heirloom of the Exile|Proof of Passage|Lucky Find|Monarch's Memento|Witness to Treason|Mapmaker's Folly|Thief's Apology|Promise Unopened|Pilgrim's Comfort|Treasure Without Price|Answer in Miniature|Relic of Small Mercies"),
    hooks: words("A tiny map appears on it only under moonlight.|Someone has carefully scratched away the maker's name.|It hums whenever it points toward {concept}.|The object is ordinary until willingly given away.|A hidden compartment contains a message in fresh ink.|Collectors insist the {material} is not native to this world."),
  },
  {
    id: "enemy", name: "Enemy Name Generator", shortName: "Enemy", symbol: "☠", category: "People",
    description: "Create monsters, undead, beasts, raiders, constructs, and bosses with encounter-ready hooks.", typeLabel: "Enemy family",
    types: [
      type("beast", "Beasts", "Fang|Claw|Howler|Stalker|Ravager|Wyrm|Maw|Raptor|Direwolf|Manticore"),
      type("undead", "Undead", "Revenant|Wraith|Ghoul|Lich|Boneguard|Death Knight|Specter|Draugr|Banshee|Graveborn"),
      type("humanoid", "Raiders", "Reaver|Marauder|Cutthroat|Warlock|Brigand|Corsair|Cultist|Slayer|Deserter|Usurper"),
      type("construct", "Constructs", "Sentinel|Golem|Automaton|Colossus|Watchman|Engine|Doll|Guardian|Juggernaut|Effigy"),
    ],
    tones: ["dark", "mystical", "rustic", "cosmic"],
    concepts: words("Ash|Bone|Night|Hunger|Plague|Storms|Ruins|Mirrors|Venom|War|Winter|Graves|Void|Thorns|Madness|Chains|Blood|Cinders|Rot|Silence|Stars|Depths|Dread|Sorrow"),
    materials: words("Ashen|Basalt|Bone|Brass|Chitin|Coral|Crystal|Flesh|Glass|Iron|Obsidian|Rotwood|Rust|Shadow|Stone|Tar|Thorn|Voidglass"),
    titles: words("Devourer of Lanterns|Last of Its Brood|Tyrant Below|Scourge of the Marches|King of Empty Graves|The Unburied|Breaker of Companies|Shepherd of Vermin|Hunger Given Form|Warden of Ruins|Voice Beneath the Floor|Doom of Pilgrims|Mother of Knives|Collector of Names|The Returning Calamity|End of the Road"),
    hooks: words("It marks prey with a scent only other monsters can detect.|The creature retreats if shown a symbol of {concept}.|Its {material} hide cracks just before it attacks.|Defeating it reveals that something larger was giving orders.|It repeats the final words of everyone it has slain.|Local hunters know one safe trail through its territory."),
  },
  {
    id: "character", name: "Character Name Generator", shortName: "Character", symbol: "♟", category: "People",
    description: "Invent fantasy given names, surnames, epithets, occupations, and heroic or villainous titles.", typeLabel: "Character role",
    types: [
      type("adventurer", "Adventurers", "Vale|Thorn|Rook|Ashford|Dawn|Strider|Voss|Ember|Kestrel|Morrow"),
      type("noble", "Nobility", "Regent|Heir|Duke|Countess|Prince|Chancellor|Margrave|Lady|Steward|Castellan"),
      type("mystic", "Mystics", "Seer|Oracle|Sage|Witch|Magus|Dreamer|Runesmith|Augur|Binder|Astrologer"),
      type("rogue", "Rogues", "Fox|Shade|Jackal|Whisper|Knave|Smuggler|Corsair|Duelist|Viper|Magpie"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Dawn|Black Harbor|Embers|the North|Lost Roads|Moonfall|Old Forest|Seven Towers|the Deep|Storm Coast|Winter Court|Bright Vale|Ash March|Broken Crown|Star Sea|the Frontier|Silver River|Red Mountain|Whispering Isles|Sunken City|Last Kingdom|Wilds|Glass Desert|Night Market"),
    materials: words("Amber|Ash|Black|Briar|Copper|Ember|Frost|Gold|Gray|Iron|Jade|Moon|Raven|River|Silver|Stone|Storm|Thorn"),
    titles: words("Keeper of Keys|Last Heir|Warden of Roads|Voice of the Court|Dragon-Friend|Oathbreaker|Shield of the Poor|Fox of the North|Reader of Stars|Captain Without a Ship|The Twice-Crowned|Friend to Ghosts|Master of Lanterns|Hunter of Truth|The Unforgotten|Bearer of Bad News"),
    hooks: words("They carry a sealed letter addressed to the ruler of {concept}.|Their family owes a dangerous debt to an old adventuring company.|They cannot remember where they learned to speak with ghosts.|A rival uses the same name and claims to be the original.|They are searching for the person who forged their title.|Their greatest victory was secretly a carefully arranged lie."),
    templates: CHARACTER_TEMPLATES,
  },
  {
    id: "faction", name: "Faction Name Generator", shortName: "Faction", symbol: "⚑", category: "People",
    description: "Name guilds, cults, knightly orders, rebel cells, merchant leagues, and secret societies.", typeLabel: "Faction kind",
    types: [
      type("order", "Orders", "Order|Knights|Wardens|Sentinels|Brotherhood|Sisterhood|Keepers|Vanguard|Paladins|Watch"),
      type("guild", "Guilds", "Guild|Company|Consortium|League|Compact|Fellowship|Union|Circle|Cabal|Collective"),
      type("cult", "Cults", "Cult|Choir|Children|Disciples|Witnesses|Hands|Flame|Congregation|Acolytes|Prophets"),
      type("rebels", "Rebels", "Rebellion|Resistance|Freeblades|Liberators|Insurgency|Underground|Partisans|Outcasts|Front|Unbound"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic"],
    concepts: words("Dawn|Ashes|Nine Keys|Open Road|Iron Crown|Last Star|Thorns|Free Cities|Silent Bell|Red Hand|Moon|First Flame|Hidden Door|Storm|Broken Chain|Deep Roads|Golden Scale|Wild Hunt|White Tower|Tides|Old Oath|Ravens|Greenwood|Seven Seals"),
    materials: words("Amber|Black|Brass|Bronze|Crimson|Crystal|Emerald|Golden|Gray|Iron|Ivory|Jade|Obsidian|Red|Silver|Steel|Verdant|White"),
    titles: words("Guardians of the Compact|Enemies of Tyrants|Merchants Without Borders|Keepers of the Secret Fire|Friends of the Forgotten|Witnesses to the End|Defenders of the Old Law|Servants of No Crown|The Hand Behind the Curtain|Wardens of the Last Gate|The Unbroken Alliance|Oath of the Free|Heirs to the Rebellion|Custodians of Forbidden Truth|Council in Exile|The Quiet Majority"),
    hooks: words("Every member carries a broken piece of the same {material} seal.|Their public mission hides a fierce dispute about {concept}.|The faction recognizes rank by the number of unanswered favors owed.|A recent schism left both sides using the original name.|Their safest headquarters moves to a new tavern each week.|The founder vanished after announcing the order's work was complete."),
  },
  {
    id: "settlement", name: "Settlement Name Generator", shortName: "Settlement", symbol: "⌂", category: "Places",
    description: "Build names for villages, towns, cities, ports, frontier posts, and strange planar communities.", typeLabel: "Settlement size",
    types: [
      type("village", "Villages", "Hollow|Hamlet|Crossing|Ford|Mill|Stead|Croft|Meadow|Green|Wick"),
      type("town", "Towns", "Town|Market|Bridge|Landing|Haven|Rest|Reach|Watch|Gate|Burgh"),
      type("city", "Cities", "City|Spire|Metropolis|Crown|Citadel|Bastion|Hold|Court|Seat|Capital"),
      type("port", "Ports", "Harbor|Port|Quay|Anchorage|Bay|Dock|Strand|Wharf|Sound|Inlet"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Dawn|Kings|Foxes|Ravens|Embers|Tides|Pilgrims|Glass|Storms|Old Road|Moon|Harvest|Iron|Saints|Thorns|Whispers|Red River|Stars|Mists|Dragons|Seven Hills|Winter|Sunfall|Border"),
    materials: words("Amber|Ash|Blackstone|Brass|Brick|Copper|Crystal|Flint|Gold|Granite|Iron|Ivory|Marble|Oak|Redstone|Silver|Slate|Whitewood"),
    titles: words("Jewel of the Marches|Last Stop Before the Wilds|City of Open Gates|Refuge of Pilgrims|Crown of the Coast|Market of a Hundred Tongues|Fortress That Never Fell|Lantern of the North|City Beneath the Bells|Crossroads of Kings|Haven of the Exiled|Seat of the Old Law|Town at World's End|Harbor of Returning Ships|The Unconquered City|Gateway to Adventure"),
    hooks: words("Every street slopes toward a sealed well at the center of town.|The settlement celebrates {concept} with a week of masked feasts.|Its oldest district is built entirely from {material}.|No map agrees on the road that leads away from it.|A different guild rings the curfew bell each night.|The mayor is elected by the first traveler to arrive each spring."),
  },
  {
    id: "kingdom", name: "Kingdom Name Generator", shortName: "Kingdom", symbol: "♜", category: "Places",
    description: "Name realms, empires, republics, principalities, tribal confederations, and fallen nations.", typeLabel: "Realm form",
    types: [
      type("monarchy", "Monarchies", "Kingdom|Realm|Crown|Principality|Duchy|Throne|Dominion|Highlands|Marches|Court"),
      type("empire", "Empires", "Empire|Imperium|Hegemony|Dynasty|Ascendancy|Sovereignty|Mandate|Grand Realm|Conquest|Pact"),
      type("republic", "Republics", "Republic|Commonwealth|Free State|League|Federation|Concord|Assembly|Compact|Union|Alliance"),
      type("fallen", "Fallen realms", "Ruins|Remnant|Exile|Lost Realm|Broken Crown|Old Kingdom|Ashlands|Dead Empire|Shattered Court|Forgotten March"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Sun|Moon|Seven Rivers|Iron|Jade|Ravens|Dragons|Free Peoples|Ash|Glass|Thorns|High Peaks|Golden Coast|Deep Forest|Red Desert|Stars|Storm Sea|Ancestors|Twin Crowns|Old Gods|Bright Fields|Frost|Pearl Isles|Endless Road"),
    materials: words("Amber|Black|Brass|Bronze|Crimson|Crystal|Emerald|Golden|Granite|Iron|Ivory|Jade|Obsidian|Pearl|Ruby|Silver|Steel|White"),
    titles: words("Realm of Ten Thousand Banners|Empire Where the Sun Rises|Kingdom of the Last Dragon|Crown Beyond the Mountains|Land of the Unbroken Oath|Dominion of Seven Rivers|Republic of Open Gates|Throne of the Star Sea|Country Without a King|Heir to the Old World|Shield of the Western March|Realm of Two Moons|Empire of Eternal Spring|Kingdom Under Glass|Nation of the Free Companies|Last Light of Civilization"),
    hooks: words("Its ruler inherits a crown but not the right to wear it.|The border follows the migration of a sacred animal.|Every province tells a different story about the founding of {concept}.|Its {material} banners may be carried only by elected heroes.|The realm's greatest rival shares its language and royal bloodline.|A treaty forbids the kingdom from building roads toward the east."),
  },
  {
    id: "dungeon", name: "Dungeon Name Generator", shortName: "Dungeon", symbol: "▦", category: "Places",
    description: "Create ruins, crypts, vaults, towers, caves, prisons, and multidimensional adventure sites.", typeLabel: "Dungeon kind",
    types: [
      type("ruin", "Ruins", "Ruins|Sanctum|Temple|Palace|Observatory|Monastery|Archive|Forum|Theater|Aqueduct"),
      type("underground", "Underground", "Caverns|Mines|Depths|Grotto|Underways|Chasm|Tunnels|Hollows|Catacombs|Burrows"),
      type("fortress", "Fortresses", "Keep|Citadel|Fortress|Tower|Bastion|Prison|Vault|Redoubt|Stronghold|Gatehouse"),
      type("strange", "Strange places", "Maze|Dream|Mirror-Hall|Worldship|Pocket Realm|Engine|Crucible|Library|Garden|Clockwork"),
    ],
    tones: ["dark", "mystical", "rustic", "cosmic"],
    concepts: words("Ash|Broken Saints|Lost King|Thorns|Echoes|Night|Seven Doors|Sleeping God|Iron Choir|Frost|Mirrors|Whispers|Blood Moon|Forgotten War|Deep Flame|Stars|Rot|Chains|Last Oracle|Tides|Hungry Earth|Silence|Old Machines|Doom"),
    materials: words("Basalt|Bone|Brass|Brick|Coral|Crystal|Granite|Ice|Iron|Ivory|Marble|Obsidian|Root|Sandstone|Slate|Steel|Volcanic Glass|White Stone"),
    titles: words("Tomb That Refuses the Dead|Vault of the Last King|Prison Beneath the World|Maze Without a Center|Temple of Unanswered Prayers|Keep of the Hollow Crown|Archive of Forbidden Names|Tower That Fell Upward|Catacombs of the First War|Crucible of Failed Heroes|Doorway to Yesterday|Fortress of the Sleeping Host|Garden Beyond Death|Palace Under the Lake|Engine at the World's Heart|Last Dungeon of the Old Age"),
    hooks: words("Each opened door quietly locks a different one elsewhere.|The {material} walls rearrange whenever someone lies.|A rival party entered seeking {concept} and never returned.|The final chamber can be seen from the entrance but not reached directly.|Monsters inside leave offerings for something even deeper.|A friendly ghost keeps an accurate map but omits one room."),
  },
  {
    id: "tavern", name: "Tavern Name Generator", shortName: "Tavern", symbol: "♨", category: "Places",
    description: "Name inns, alehouses, tea rooms, roadside lodges, adventurer halls, and underworld clubs.", typeLabel: "Venue kind",
    types: [
      type("tavern", "Taverns", "Tavern|Alehouse|Taproom|Public House|Beer Hall|Saloon|Drinking Den|Cellar|Brewhouse|Common Room"),
      type("inn", "Inns", "Inn|Lodge|Rest|Wayhouse|Hostel|Guesthouse|Roadhouse|Coaching House|Traveler's Hall|Boarding House"),
      type("refined", "Refined", "Tea Room|Wine Bar|Salon|Supper Club|Coffeehouse|Parlor|Dining Hall|Garden|Lounge|Cabaret"),
      type("strange", "Unusual", "Adventurer Hall|Floating Bar|Ghost Inn|Planar Pub|Monster Cafe|Airship Lounge|Bathhouse|Gambling Den|Secret Club|Night Market"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic"],
    concepts: words("Crown|Dragon|Fox|Moon|Lantern|Anchor|Sword|Kettle|Pilgrim|Raven|Stag|Rose|Boot|Bell|Griffin|Compass|Oak|Mermaid|Tankard|Badger|Star|Bridge|Road|Hearth"),
    materials: words("Amber|Black|Brass|Broken|Copper|Crystal|Dancing|Golden|Green|Iron|Ivory|Laughing|Old|Red|Silver|Singing|Three|White"),
    titles: words("Last Drink Before the Wilds|Home of Returning Heroes|Best Stew on the King's Road|Where Every Story Begins|House of a Hundred Toasts|Shelter from Any Storm|The Adventurer's Second Home|Inn at the Edge of the Map|Meeting Place of Old Enemies|Warmest Hearth in the North|The Smuggler's Honest Business|Neutral Ground|House That Never Closes|Last Light on the Road|Where the Quest Board Hangs|A Bed, a Meal, and a Rumor"),
    hooks: words("The proprietor trades one free meal for a story never told before.|A locked booth is permanently reserved for the heroes of {concept}.|The sign's {material} figure changes pose after midnight.|Every room is named after a guest who disappeared.|The cellar door opens onto a different city once a month.|The house specialty grants vivid but unreliable prophetic dreams."),
  },
  {
    id: "potion", name: "Potion Name Generator", shortName: "Potion", symbol: "⚗", category: "Magic",
    description: "Mix names for healing draughts, poisons, elixirs, oils, powders, and experimental brews.", typeLabel: "Concoction",
    types: [
      type("healing", "Restoratives", "Tonic|Elixir|Draught|Remedy|Balm|Cordial|Restorative|Panacea|Salve|Tea"),
      type("enhancement", "Enhancements", "Philter|Serum|Oil|Essence|Catalyst|Infusion|Distillate|Concentrate|Brew|Extract"),
      type("poison", "Poisons", "Venom|Toxin|Poison|Bane|Ichor|Nightshade|Blight|Widow's Kiss|Blackdrop|Rot"),
      type("strange", "Strange brews", "Dream|Mist|Powder|Smoke|Ink|Salt|Syrup|Tincture|Spore|Mercury"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Vitality|Sleep|Giants|Speed|Truth|Night Vision|Stone Skin|Luck|Fire Breath|Water Walking|Memory|Dreams|Invisibility|Courage|Frost|Venom|Youth|Ghosts|Moonlight|Clarity|Rage|Mending|Stars|Transformation"),
    materials: words("Amber|Black|Blue|Copper|Crimson|Crystal|Emerald|Golden|Gray|Iridescent|Milky|Opaline|Pearl|Ruby|Silver|Smoking|Verdant|Violet"),
    titles: words("Apothecary's Triumph|Last-Ditch Remedy|Hero's Second Wind|Witch's Private Reserve|Physician's Impossible Cure|Assassin's Courtesy|Dreamer's Shortcut|Bottled Miracle|Alchemist's Regret|Giant's Breakfast|Moonlit Antidote|King's Emergency Draught|Experimental Batch Seven|Saint's Small Mercy|Dragon's Nightcap|Cure for Almost Anything"),
    hooks: words("The liquid briefly forms the face of whoever last brewed it.|Its {material} color vanishes when the dose has spoiled.|A full dose grants {concept}; half a dose has a stranger effect.|The recipe requires one ingredient gathered willingly from a monster.|Its bottle always feels warm on the night before a battle.|The antidote is common, but works only before the first symptom."),
  },
  {
    id: "artifact", name: "Artifact Name Generator", shortName: "Artifact", symbol: "♢", category: "Gear",
    description: "Name singular relics, impossible machines, royal regalia, sacred objects, and world-changing treasures.", typeLabel: "Artifact form",
    types: [
      type("relic", "Sacred relics", "Grail|Reliquary|Icon|Censer|Ark|Shrine|Tablet|Halo|Bell|Crown"),
      type("device", "Devices", "Engine|Lens|Compass|Orrery|Key|Loom|Clock|Crucible|Astrolabe|Machine"),
      type("regalia", "Regalia", "Scepter|Throne|Mantle|Orb|Signet|Banner|Diadem|Seal|Chalice|Sword"),
      type("oddity", "Oddities", "Egg|Seed|Mirror|Mask|Box|Door|Feather|Skull|Flame|Heart"),
    ],
    tones: ["heroic", "dark", "mystical", "cosmic"],
    concepts: words("Creation|Last Age|Seven Stars|First King|Sea|Sun|Moon|Dreams|Time|Death|Rebirth|Truth|War|Memory|World Tree|Dragons|Void|Fate|Storms|Silence|Lost Gods|Infinity|Mercy|Dominion"),
    materials: words("Adamant|Amber|Bone|Brass|Crystal|Dragonbone|Ebony|Glass|Gold|Iron|Ivory|Jade|Meteorite|Mithril|Obsidian|Pearl|Silver|Starmetal"),
    titles: words("Axis of the World|Last Work of the Makers|Key to Every Door|Crown of the First Age|Machine That Remembers Tomorrow|Heart of the Drowned God|Promise of Creation|Mirror of Possible Kings|Seed of the Final World|Bell That Ends Wars|Eye Beyond the Stars|Throne Without a Ruler|Archive of All Names|Gift No Mortal Requested|Relic of the Lost Heavens|Answer to the Oldest Question"),
    hooks: words("Every kingdom records a different origin for the artifact.|The {material} object is lighter than its own shadow.|Using it solves one crisis while awakening another tied to {concept}.|It recognizes a rightful owner but refuses to explain the test.|A missing fragment changes the meaning of every inscription.|The artifact has begun sending dreams to people who never touched it."),
  },
  {
    id: "quest", name: "Quest Name Generator", shortName: "Quest", symbol: "!", category: "Adventure",
    description: "Title hunts, rescues, mysteries, deliveries, expeditions, heists, and campaign-scale objectives.", typeLabel: "Quest kind",
    types: [
      type("hunt", "Hunts", "Hunt|Slaying|Pursuit|Bounty|Chase|Culling|Trial|Challenge|Showdown|Reckoning"),
      type("journey", "Journeys", "Journey|Pilgrimage|Expedition|Voyage|Descent|Crossing|Road|Ascent|Passage|Return"),
      type("intrigue", "Intrigue", "Conspiracy|Mystery|Heist|Investigation|Masquerade|Betrayal|Secret|Scheme|Gambit|Ruse"),
      type("rescue", "Rescue & duty", "Rescue|Defense|Escort|Delivery|Recovery|Evacuation|Promise|Duty|Stand|Reunion"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Lost Heir|Dragon|Sunken Bell|Seven Keys|Winter|Ash King|Broken Bridge|Moon Temple|Missing Caravan|Old Debt|Silent Village|Starfall|Iron Crown|Ghost Fleet|Stolen Name|Last Harvest|Crimson Map|Sleeping Giant|Forgotten Road|False Saint|Storm|Empty Throne|Wild Hunt|World's End"),
    materials: words("Amber|Black|Brass|Broken|Crimson|Crystal|Emerald|Golden|Iron|Ivory|Jade|Obsidian|Red|Silver|Starry|Stone|White|Wooden"),
    titles: words("A Favor for the Crown|No Road Back|The Price of Victory|What the Dead Remember|Before the Last Bell|A Promise Kept|Trouble at the Border|Into the Unknown|The Enemy of My Enemy|One Night to Save the City|The Long Way Home|A Debt Paid in Fire|When the Stars Align|The Door Beneath the Mountain|For Those We Left Behind|The Beginning of the End"),
    hooks: words("The patron has concealed why {concept} matters to them personally.|A competing party accepted the same quest at sunrise.|The obvious route is safe but will arrive one day too late.|Completing the job publicly creates a powerful new enemy.|The reward is genuine, though not in the form the heroes expect.|A simple clue links the quest to a larger threat already nearby."),
  },
  {
    id: "deity", name: "Deity Name Generator", shortName: "Deity", symbol: "☼", category: "Magic",
    description: "Name gods, saints, elder spirits, divine aspects, forgotten patrons, and cosmic powers.", typeLabel: "Divine nature",
    types: [
      type("celestial", "Celestial", "God|Goddess|Lord|Lady|Radiance|Father|Mother|Sovereign|Crown|Voice"),
      type("nature", "Nature spirits", "Spirit|Keeper|Green One|River-Father|Earth-Mother|Stormcaller|Old Oak|Wild One|Horned Lord|Seed-Bearer"),
      type("dark", "Dark powers", "Devourer|Whisperer|Exile|Shadow|Hunger|Widow|Jailer|Nameless One|Sleeper|Empty King"),
      type("saint", "Saints & heroes", "Saint|Martyr|Ascendant|Teacher|Pilgrim|Champion|Oracle|Ancestor|Lawgiver|Guardian"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Dawn|Death|Harvest|War|Mercy|Roads|Secrets|Storms|Sea|Fire|Dreams|Justice|Moon|Sun|Stars|Craft|Love|Winter|Memory|Travelers|Thresholds|Fate|Healing|Rebellion"),
    materials: words("Amber|Ashen|Black|Bronze|Crimson|Crystal|Emerald|Golden|Iron|Ivory|Jade|Obsidian|Pearl|Silver|Stone|Verdant|White|Wooden"),
    titles: words("Keeper of the First Flame|Mother of Returning Roads|Judge Beneath the Stars|Lord of the Unspoken Oath|Shepherd of the Dead|Patron of Impossible Causes|Lady of Seven Faces|Guardian at Every Door|Father of Honest Work|The God Who Listens|Saint of the Last Chance|Voice in the Storm|Queen Beyond the Moon|Warden of Mortal Dreams|The Kindly Stranger|Maker of Heroes"),
    hooks: words("Worshipers leave a single {material} object at crossroads.|The faith disagrees whether {concept} is a gift or a punishment.|The deity answers prayers through coincidences rather than miracles.|Its oldest temple has no image of the god, only an empty chair.|A rival religion claims this power is one face of their own deity.|The god recently spoke the same warning to every oracle at once."),
  },
  {
    id: "ship", name: "Ship Name Generator", shortName: "Ship", symbol: "➶", category: "Adventure",
    description: "Name sailing ships, airships, spelljammers, submarines, caravans, and legendary flagships.", typeLabel: "Vessel kind",
    types: [
      type("sailing", "Sailing ships", "Sloop|Brig|Galleon|Cutter|Schooner|Corvette|Frigate|Caravel|Dhow|Clipper"),
      type("air", "Airships", "Skyship|Cloudcutter|Zeppelin|Aetherwing|Windskiff|Skybarge|Cloudrunner|Starwing|Aerostat|Stormsail"),
      type("strange", "Strange vessels", "Spelljammer|Voidship|Submersible|Sandship|Worldship|Dreamboat|Planar Ark|Leviathan|Timecraft|Ghost Ship"),
      type("fleet", "Warships", "Dreadnought|Man-of-War|Destroyer|Flagship|Ironclad|Cruiser|Privateer|Raider|Carrier|Battle Barge"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Dawn|Fortune|Storm|Tides|Freedom|Last Star|Sea Queen|Red Moon|Homecoming|Wanderer|North Wind|Leviathan|Pilgrim|Revenge|Silver Horizon|Dragon|Void|Hope|Tempest|Old Salt|Victory|Falling Star|Wild Rose|Endless Road"),
    materials: words("Amber|Black|Brass|Bronze|Copper|Crimson|Crystal|Golden|Iron|Ivory|Jade|Obsidian|Red|Silver|Star-metal|Steel|White|Wooden"),
    titles: words("Pride of the Fleet|Last Ship Home|Queen of the Open Sea|Terror of the Trade Winds|First Beyond the Horizon|Flagship of the Free|Hunter of Leviathans|Ghost of the Northern Run|Fastest Hull Alive|Pilgrim Between Worlds|The Captain's Second Chance|Herald of Discovery|Breaker of Blockades|Jewel of the Skyways|Ship That Outran Night|Home to the Lost"),
    hooks: words("Its figurehead points toward {concept} instead of north.|The crew paints one {material} mark for every completed voyage.|A former captain is still aboard, though officially dead.|The vessel is famous for surviving a storm no other ship remembers.|One cabin is larger inside than the hull permits.|Its bell rings whenever someone aboard decides not to return home."),
  },
  {
    id: "book", name: "Book & Tome Generator", shortName: "Book & Tome", symbol: "▤", category: "Adventure",
    description: "Title grimoires, histories, field guides, forbidden treatises, holy texts, journals, and prophecies.", typeLabel: "Book kind",
    types: [
      type("arcane", "Arcane", "Grimoire|Codex|Tome|Spellbook|Lexicon|Arcanum|Primer|Manual|Thesis|Concordance"),
      type("history", "Histories", "Chronicle|History|Annals|Testament|Record|Saga|Account|Genealogy|Biography|Gazetteer"),
      type("guide", "Guides", "Field Guide|Bestiary|Atlas|Handbook|Compendium|Almanac|Catalogue|Encyclopedia|Traveler's Guide|Herbal"),
      type("forbidden", "Forbidden", "Black Book|Sealed Text|Apocrypha|Confession|Prophecy|Revelation|Lament|Whisper|Final Chapter|Redacted Volume"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("Dragons|Dead Kings|Seven Stars|Old Roads|Forbidden Magic|Herbs|Lost Cities|Sea Monsters|Dreams|Time|Royal Bloodlines|Underworld|Saints|War|Planar Gates|Ancient Machines|Poisons|Ghosts|Fate|Moon|First Age|Wild Places|True Names|End of Days"),
    materials: words("Ashen|Black|Brass-Bound|Bronze|Crimson|Crystal|Emerald|Golden|Iron-Clasped|Ivory|Jade|Leather|Obsidian|Paper|Silver|Stone|White|Wooden"),
    titles: words("A Complete and Honest Account|Notes from the Edge of the World|The Author's Final Warning|Volume Forbidden by Three Kings|Collected Errors of the Ancients|A Pilgrim's Reliable Companion|The Book That Writes Back|Lessons for the Last Apprentice|An Argument Against Destiny|Observations from Beyond the Veil|The Missing Royal Chronicle|What Every Monster Hunter Should Know|A Treatise in Seven Parts|The Unabridged Heresy|Letters Never Sent|Instructions for the Next Age"),
    hooks: words("A later reader has filled every margin with corrections.|The {material} cover cannot be opened under direct sunlight.|One chapter about {concept} has been neatly removed.|The index lists a person who has not been born yet.|Reading it aloud causes small details in the illustrations to change.|The final page asks the reader to continue the work in their own hand."),
    templates: BOOK_TEMPLATES,
  },
  {
    id: "plant", name: "Fantasy Plant Generator", shortName: "Fantasy Plant", symbol: "❧", category: "Places",
    description: "Name magical flowers, medicinal herbs, dangerous fungi, ancient trees, and impossible crops.", typeLabel: "Plant kind",
    types: [
      type("flower", "Flowers", "Bloom|Blossom|Rose|Lily|Orchid|Bell|Petal|Crown|Starflower|Trumpet"),
      type("herb", "Herbs", "Wort|Mint|Root|Leaf|Sage|Thyme|Balm|Fern|Nettle|Reed"),
      type("tree", "Trees", "Oak|Yew|Willow|Pine|Cedar|Ash|Birch|Thorn|Mangrove|Worldtree"),
      type("fungus", "Fungi", "Cap|Mushroom|Mold|Spore|Shelf|Puffball|Morel|Truffle|Toadstool|Lantern Fungus"),
    ],
    tones: ["dark", "mystical", "rustic", "cosmic"],
    concepts: words("Moon|Sun|Graves|Dreams|Dragons|Winter|Embers|Healing|Sleep|Memory|Blood|Stars|Storms|Ghosts|Giants|Luck|Silence|Mirrors|Thieves|Witches|Tides|Dawn|Shadows|Travelers"),
    materials: words("Amber|Black|Blue|Bone|Copper|Crimson|Crystal|Emerald|Golden|Gray|Ivory|Jade|Obsidian|Pearl|Silver|Spotted|Verdant|Violet"),
    titles: words("Healer's Final Resort|Widow's Garden|Flower of Returning Dreams|Root Beneath the Mountain|Herb of Seven Remedies|Bloom of the Starless Night|Tree That Remembers Names|Spore of Unwanted Truth|Pilgrim's Lucky Find|Dragon's Favorite Weed|Monarch of the Deep Forest|Moon-Garden Treasure|The Alchemist's Shortcut|Cure Hidden in Plain Sight|Seed of the Old World|Botanist's Impossible Specimen"),
    hooks: words("It blooms only when someone nearby dreams of {concept}.|The {material} sap is valuable but stains skin for a year.|Eating one leaf grants a vivid memory belonging to a stranger.|Its roots slowly point toward the nearest source of fresh water.|The plant folds shut whenever a lie is spoken nearby.|Harvesters sing a specific verse to keep the spores dormant."),
  },
  {
    id: "festival", name: "Festival Name Generator", shortName: "Festival", symbol: "✺", category: "Adventure",
    description: "Create holidays, holy days, seasonal fairs, memorials, contests, and unsettling local traditions.", typeLabel: "Celebration kind",
    types: [
      type("seasonal", "Seasonal", "Festival|Fair|Feast|Revel|Carnival|Market|Jubilee|Gathering|Merrymaking|Celebration"),
      type("sacred", "Sacred", "Holy Day|Vigil|Observance|Rite|Procession|Pilgrimage|Communion|Blessing|Convocation|Remembrance"),
      type("contest", "Contests", "Tournament|Games|Race|Trial|Melee|Contest|Regatta|Hunt|Pageant|Challenge"),
      type("strange", "Strange customs", "Masquerade|Night|Silence|Exchange|Waking|Burning|Dream|Inversion|Naming|Homecoming"),
    ],
    tones: ["heroic", "dark", "mystical", "rustic", "cosmic"],
    concepts: words("First Harvest|Longest Night|Returning Sun|Founding King|Dead|Lanterns|Masks|Sea|Storms|Flowers|Dragons|Ancestors|Freedom|Moon|Stars|Old Road|Seven Saints|Embers|River|Changing Seasons|Lost Children|Victory|Peace|New Year"),
    materials: words("Amber|Black|Blue|Brass|Bronze|Crimson|Crystal|Golden|Green|Ivory|Jade|Paper|Red|Silver|White|Wooden|Woven|Yellow"),
    titles: words("Night When Every Door Opens|Feast of a Thousand Lanterns|Day the Crown Serves the Poor|Celebration of Returning Heroes|Festival at the Turning Year|Vigil for Those Still Traveling|Games of the Seven Cities|Fair of Impossible Bargains|Masquerade Without Names|Remembrance of the Last War|Jubilee of the Open Gates|Procession Beneath the Moon|The Great Spring Waking|Tournament of the Free Companies|Night of Shared Stories|Homecoming of the Ancestors"),
    hooks: words("Every household builds a {material} figure representing {concept}.|Visitors are expected to exchange names until sunrise.|The winner of the main contest becomes mayor for one day.|A banned verse in the traditional song predicts a coming disaster.|The festival began as a truce and still suspends all local feuds.|At midnight, every lantern is extinguished to invite one honest wish."),
  },
];

const PROPER_START = words("ael|ar|ash|bel|bryn|cael|cor|daer|el|fae|gal|hal|is|jor|kael|lor|mor|nyx|or|rae|ser|thal|ul|val|wyr|zae");
const PROPER_MIDDLE = words("a|ae|ai|an|ara|e|el|en|er|i|ia|il|in|o|on|or|u|un|y");
const PROPER_END = words("bar|born|dell|dor|dris|far|garde|ia|iel|ion|is|kar|len|mere|mon|neth|or|os|riel|ryn|sai|thal|us|wyn");

function pick<T>(list: T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

function coinedName(random: () => number, initial?: string): string {
  let starts = PROPER_START;
  if (initial) {
    const matches = PROPER_START.filter((part) => part[0].toLowerCase() === initial.toLowerCase());
    if (matches.length) starts = matches;
  }
  const raw = pick(starts, random) + pick(PROPER_MIDDLE, random) + pick(PROPER_END, random);
  return raw[0].toUpperCase() + raw.slice(1);
}

function subtypeWords(definition: GeneratorDefinition, subtype?: string): string[] {
  const selected = definition.types.find((entry) => entry.id === subtype);
  return selected ? selected.words : definition.types.flatMap((entry) => entry.words);
}

function chosenTone(definition: GeneratorDefinition, requested?: keyof typeof TONE_WORDS): keyof typeof TONE_WORDS {
  return requested && definition.tones.includes(requested) ? requested : definition.tones[0];
}

function matchingInitial(adjectives: readonly string[], subjects: string[], random: () => number): string | undefined {
  const subjectInitials = new Set(subjects.map((word) => word[0].toLowerCase()));
  const choices = [...new Set(adjectives.map((word) => word[0].toLowerCase()).filter((initial) => subjectInitials.has(initial)))];
  return choices.length ? pick(choices, random) : undefined;
}

function pickMatching(list: readonly string[], initial: string | undefined, random: () => number): string {
  if (!initial) return pick([...list], random);
  const matches = list.filter((word) => word[0].toLowerCase() === initial.toLowerCase());
  return pick(matches.length ? [...matches] : [...list], random);
}

function cleanWorldWord(value?: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function templatesFor(definition: GeneratorDefinition, style: GeneratorStyle): string[] {
  return definition.templates?.[style] || COMMON_TEMPLATES[style];
}

function render(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, token) => tokens[token] || "").replace(/\s+/g, " ").trim();
}

export function definitionById(id: string): GeneratorDefinition {
  return GENERATOR_DEFINITIONS.find((definition) => definition.id === id) || GENERATOR_DEFINITIONS[0];
}

export function generateNames(
  definitionOrId: GeneratorDefinition | string,
  options: GeneratorOptions = {},
  count = 10,
  random: () => number = Math.random,
): GeneratedName[] {
  const definition = typeof definitionOrId === "string" ? definitionById(definitionOrId) : definitionOrId;
  const style = options.style || "evocative";
  const subjects = subtypeWords(definition, options.subtype);
  const adjectives = TONE_WORDS[chosenTone(definition, options.tone)];
  const worldWord = cleanWorldWord(options.worldWord);
  let templates = templatesFor(definition, style);
  let appendWorldWord = false;
  if (options.alliteration) {
    const alliterative = templates.filter((template) => template.includes("{adjective}") && template.includes("{subject}"));
    if (alliterative.length) templates = alliterative;
  }
  if (worldWord) {
    const themed = templates.filter((template) => template.includes("{concept}"));
    if (themed.length) templates = themed;
    else appendWorldWord = true;
  }

  const results: GeneratedName[] = [];
  const seen = new Set<string>();
  const target = Math.max(1, Math.min(50, Math.floor(count) || 10));
  for (let attempt = 0; results.length < target && attempt < target * 80; attempt++) {
    const initial = options.alliteration ? matchingInitial(adjectives, subjects, random) : undefined;
    const tokens = {
      adjective: pickMatching(adjectives, initial, random),
      subject: pickMatching(subjects, initial, random),
      concept: worldWord || pick(definition.concepts, random),
      material: pick(definition.materials, random),
      title: pick(definition.titles, random),
      proper: coinedName(random, initial),
      proper2: coinedName(random),
    };
    let name = render(pick(templates, random), tokens);
    if (appendWorldWord) name += " of " + worldWord;
    if (options.prefixThe && !/^the\b/i.test(name)) name = "The " + name;
    if (seen.has(name)) continue;
    seen.add(name);
    results.push({ name, hook: render(pick(definition.hooks, random), tokens) });
  }
  return results;
}

function tokenCount(definition: GeneratorDefinition, token: string, options: GeneratorOptions): number {
  if (token === "adjective") return TONE_WORDS[chosenTone(definition, options.tone)].length;
  if (token === "subject") return subtypeWords(definition, options.subtype).length;
  if (token === "concept") return cleanWorldWord(options.worldWord) ? 1 : definition.concepts.length;
  if (token === "material") return definition.materials.length;
  if (token === "title") return definition.titles.length;
  if (token === "proper" || token === "proper2") return PROPER_START.length * PROPER_MIDDLE.length * PROPER_END.length;
  return 1;
}

export function estimatePossibilities(definitionOrId: GeneratorDefinition | string, options: GeneratorOptions = {}): number {
  const definition = typeof definitionOrId === "string" ? definitionById(definitionOrId) : definitionOrId;
  const styles: GeneratorStyle[] = options.style ? [options.style] : ["concise", "evocative", "legendary"];
  let total = 0;
  for (const style of styles) {
    for (const template of templatesFor(definition, style)) {
      let combinations = 1;
      for (const match of template.matchAll(/\{(\w+)\}/g)) combinations *= tokenCount(definition, match[1], options);
      total += combinations;
    }
  }
  return total;
}

export const QUICK_GENERATOR_IDS = [
  "weapon", "armor", "spell", "currency", "item", "enemy",
  "character", "settlement", "dungeon", "tavern", "quest", "faction",
];
