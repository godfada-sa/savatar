const ACCEPTED_REFERENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIN_REFERENCE_EDGE = 512;
const MAX_REFERENCE_BYTES = 2_000_000;
const MAX_STORED_EDGE = 1280;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the reference image."));
    reader.readAsDataURL(blob);
  });
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Unable to prepare the reference image.")),
      "image/webp",
      0.88,
    );
  });
}

/** Validate provider constraints and shrink large images before local storage. */
export async function prepareReferenceImage(file?: File): Promise<string> {
  if (!file || !ACCEPTED_REFERENCE_TYPES.has(file.type) || file.size > MAX_REFERENCE_BYTES) {
    throw new Error("Choose a JPEG, PNG, or WebP image under 2 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < MIN_REFERENCE_EDGE || bitmap.height < MIN_REFERENCE_EDGE) {
      throw new Error("Reference images must be at least 512 × 512 pixels.");
    }

    const scale = Math.min(1, MAX_STORED_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/webp") return blobToDataUrl(file);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare the reference image.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return blobToDataUrl(await canvasToWebp(canvas));
  } finally {
    bitmap.close();
  }
}

export function savePreparedReferenceImage(dataUrl: string) {
  try {
    localStorage.setItem("savatar-reference-image", dataUrl);
  } catch {
    throw new Error("This browser has no space to save the image. Clear older site data and try again.");
  }
}
