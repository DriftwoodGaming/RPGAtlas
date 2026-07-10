# Your Game Is a Folder

*This page is about the **desktop app** (RPGAtlas-Desktop). In the web version your game
lives inside your browser instead — see [the note at the bottom](#using-the-web-version-instead).*

In the RPGAtlas desktop app, **every game you make is a real folder on your computer** —
one you can see in your file manager, open, copy, back up to a USB stick, zip up to send to
a friend, and drop your own pictures and sounds straight into. This is exactly how the big
game-making tools work, and it means **your game is never trapped inside the program**.

## Starting the app: the Project Manager

When you open the desktop app, it greets you with the **Project Manager** instead of jumping
straight into the editor:

- **➕ New Project** — give your game a name, pick a folder to keep it in, choose a starter
  template (**Blank**, **Starter**, or the **Atlas Quest** sample), and RPGAtlas makes the
  folder for you and opens the editor on it.
- **📂 Open Project** — reopen a game you already made. Your recent games are listed for
  one-click opening, and **Browse…** lets you pick any game folder on your computer.

Inside the editor you can always come back here with **File ▸ New Project** or
**File ▸ Open Project** — RPGAtlas saves the game you have open first, so nothing is lost.

## What's inside a game folder

Open your game's folder in your file manager and you'll see something like this:

```
My Awesome Game/
├─ game.rpgatlas      ← your game itself (double-click it to open the game)
├─ assets/            ← drop your own pictures and sounds here (see below)
│  ├─ characters/         walking sprites
│  ├─ facesets/           message-box faces
│  ├─ enemies/            battlers
│  ├─ tilesets/           map tiles
│  └─ audio/              music and sound effects
├─ .atlas/            ← RPGAtlas's own helper files (safe to ignore)
└─ saves/             ← playtest save slots
```

- **`game.rpgatlas`** is your whole game in one file — maps, events, database, everything.
  It's the file you double-click to open the game.
- **`assets/`** is where your own art and music go. See
  **[Adding Your Own Art and Music](Adding-Your-Own-Art-and-Music)**.
- **`.atlas/`** is where RPGAtlas keeps helper files (a list of your assets, sliced tiles,
  and a few recent backups of `game.rpgatlas`). You never need to touch it, and it's safe to
  leave out of a backup.

## Your game saves itself

While you work, RPGAtlas **autosaves straight into your game's folder** — there's no
"save to a file" step to remember. Your folder *is* your game.

- Every save is written safely, so a crash in the middle of saving can never scramble your
  game.
- RPGAtlas keeps the **last few versions** in `.atlas/backup/` in case you ever want to step
  back.
- **Ctrl+S** (or **File ▸ Save Project**) saves right now instead of waiting.
- If your computer shuts down before a save finishes, RPGAtlas notices next time and offers
  to **bring your unsaved changes back**.
- If the game's file changes outside the editor (say another program edits it), RPGAtlas
  spots it when you come back and offers to load the newer version.

**Export is different from saving.** **File ▸ Export Project As File…** makes a single
shareable `.json` copy with all its pictures and sounds baked in — handy for sending your
game to someone who will open it somewhere else. Your everyday work is already saved in the
folder; Export is only for making a portable copy.

## Opening a game by double-clicking it

Because your game is a real file, you can **double-click `game.rpgatlas`** (or drop your
game's folder onto the app) and RPGAtlas opens straight into that game, skipping the Project
Manager. If RPGAtlas is already open, double-clicking another game brings the window to the
front and switches to it — after saving the game you were working on first — instead of
opening a second copy.

On Windows you tell the app to open `.rpgatlas` files once — right-click a `game.rpgatlas`
▸ **Open with** ▸ choose RPGAtlas ▸ **Always use this app** — and from then on every game is
one double-click away.

## Copying, backing up, and sharing

Everything a game needs is inside its folder, so you can treat the folder as *the game*:

- **Back it up** by copying the folder to another drive or a USB stick.
- **Move it** to another computer — copy the folder over, open it there, and every map,
  picture, and sound comes along.
- **Zip it** to email or upload it. Whoever unzips it can open it in their own RPGAtlas.

## Bringing an older game into a folder

If you made a game in an older version of the desktop app (before games were folders),
RPGAtlas greets you with a friendly **"let's put your game in a folder"** button the next
time you open it. One click — pick a name and a place — and your old game becomes a proper
folder, with its pictures and sounds tidied in for you. Nothing is left behind.

## Using the web version instead

The **web version** of RPGAtlas (the one that runs in a browser tab) keeps your game inside
your browser rather than in a folder, and you back it up with **File ▸ Export Project As
File…**. It's perfect for trying things out with nothing to install. When you're ready for
folders, double-clicking, and dropping in your own files, use the **desktop app** — your
exported game file opens there and can be moved into a folder in one click.
