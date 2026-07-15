/* RPGAtlas — project icon importer.
   Turns user images into stable 32×32 PNG cells that extend the built-in icon
   atlas. Cells live in proj.assets.icons so every project output keeps them.
   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const MAX_CUSTOM_ICONS = 512;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read " + file.name));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string, name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(name + " is not a readable image."));
    image.src = src;
  });
}

async function sliceFile(file: File): Promise<string[]> {
  if (!file.type.startsWith("image/")) throw new Error(file.name + " is not an image file.");
  const src = await readDataUrl(file);
  const image = await loadImage(src, file.name);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height || width % 32 !== 0 || height % 32 !== 0) {
    throw new Error(file.name + " must be 32×32 pixels or a sheet whose width and height are multiples of 32.");
  }
  const icons: string[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  for (let y = 0; y < height; y += 32) {
    for (let x = 0; x < width; x += 32) {
      g.clearRect(0, 0, 32, 32);
      g.drawImage(image, x, y, 32, 32, 0, 0, 32, 32);
      icons.push(canvas.toDataURL("image/png"));
    }
  }
  return icons;
}

export async function addProjectIcons(
  project: any,
  files: File[],
  Assets: any,
): Promise<{ added: number; firstIndex: number }> {
  const current = Array.isArray(project.assets && project.assets.icons) ? project.assets.icons : [];
  const imported: string[] = [];
  for (const file of files) imported.push(...await sliceFile(file));
  if (current.length + imported.length > MAX_CUSTOM_ICONS) {
    throw new Error("A project can add up to " + MAX_CUSTOM_ICONS + " custom icons. This selection would add " + imported.length + ".");
  }
  const firstIndex = Assets.BASE_ICON_COUNT + current.length;
  if (!project.assets || typeof project.assets !== "object") project.assets = { tiles: {} };
  // Keep duplicate cells: repeated frames can be intentional in an authored
  // sheet, and removing one would shift every later numeric icon index.
  project.assets.icons = current.concat(imported);
  await Assets.loadIconSet(project.assets.icons);
  return { added: imported.length, firstIndex };
}
