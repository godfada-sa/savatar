export const FULL_BODY_SWAP_PROMPT = [
  "Use the reference image only as the character's appearance and identity.",
  "Completely replace every visible part of the live camera subject with that same character, including face, hair, neck, torso, clothing, arms, hands, fingers, hips, legs, feet, and accessories; when the full body is visible, swap it from head to toe.",
  "Keep the reference character's facial features, body proportions, outfit, colors, and textures consistent in every frame.",
  "Use the live camera only for pose, expression, gaze, gestures, movement, framing, lighting, perspective, and occlusion.",
  "Track the live facial performance precisely: preserve natural eye blinks and gaze changes, and keep the lips, jaw, cheeks, and mouth shapes synchronized with the speaker's visible speech movements in every frame.",
  "Produce natural anatomy, clean boundaries, stable details, and smooth temporal motion.",
  "Do not blend in the original person's face, skin, hair, clothes, or limbs; do not create frozen eyes, unblinking eyes, delayed lip movement, a frozen mouth, duplicate limbs, extra fingers, warped hands, flicker, partial swaps, or identity drift.",
  "Preserve the original background unless another instruction explicitly replaces it.",
].join(" ");

export const FULL_OUTFIT_SWAP_PROMPT = [
  "Use the reference image only as the outfit reference.",
  "Dress the live camera subject in the complete referenced outfit from neck to feet, including all visible garments, footwear, and accessories.",
  "Keep the live subject's face, hair, identity, body proportions, pose, hands, movement, framing, lighting, and background unchanged.",
  "Preserve the live subject's natural eye blinks, gaze, facial expressions, and visible lip and mouth movements while they speak.",
  "Keep fabric, colors, fit, and details stable across frames with clean boundaries and natural occlusion.",
  "Do not alter the person's identity, expose pieces of the original clothing, duplicate limbs, distort hands, flicker, or drift between outfits.",
].join(" ");

export type StreamMode = "character" | "style" | "background" | "vton" | "vfx";

export const STREAM_MODES: { id: StreamMode; label: string; model: string }[] = [
  { id: "character", label: "Character", model: "lucy-2.5" },
  { id: "style", label: "Style Transfer", model: "lucy-2.5" },
  { id: "background", label: "Background", model: "lucy-2.5" },
  { id: "vton", label: "Virtual Try-On", model: "lucy-2.5" },
  { id: "vfx", label: "VFX Effects", model: "lucy-2.5" },
];

const DEFAULT_PROMPTS: Record<StreamMode, string> = {
  character: "Transform the visible person into a consistent, realistic character while preserving their full-body pose, motion, framing, and background.",
  style: "Apply a polished cinematic visual style while preserving the subject, motion, and scene composition.",
  background: "Replace the background with a clean professional studio while preserving the subject, lighting, and motion.",
  vton: "Apply a tasteful virtual outfit to the visible person while preserving their full-body pose, face, hands, and motion.",
  vfx: "Add subtle cinematic visual effects around the subject while preserving their identity, pose, and motion.",
};

const LEGACY_FULL_BODY_SWAP_PROMPT = "Replace the visible person's full body, face, hair, clothing, and visible limbs with the character from the reference image. Preserve pose, motion, framing, and background.";

// Lucy 2.5 rejects prompts over this length outright ("Prompt is too long"),
// which killed the AI session right after the media path connected — the base
// swap prompt itself exceeded the limit. Clamp every prompt to fit, cutting
// back to the last complete sentence so the model always gets coherent text.
const LUCY_PROMPT_LIMIT = 1015;

export function clampPrompt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= LUCY_PROMPT_LIMIT) return trimmed;
  const cut = trimmed.slice(0, LUCY_PROMPT_LIMIT);
  const lastSentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return (lastSentenceEnd > LUCY_PROMPT_LIMIT * 0.5 ? cut.slice(0, lastSentenceEnd + 1) : cut).trim();
}

export function streamPrompt(mode: StreamMode, savedPrompt: string, hasReference: boolean) {
  if (hasReference && mode === "vton") {
    return clampPrompt(FULL_OUTFIT_SWAP_PROMPT);
  }
  if (hasReference) {
    const saved = savedPrompt.trim();
    if (!saved) return clampPrompt(FULL_BODY_SWAP_PROMPT);
    if (saved.includes(FULL_BODY_SWAP_PROMPT)) return clampPrompt(saved);
    const modifiers = saved.replace(LEGACY_FULL_BODY_SWAP_PROMPT, "").trim();
    if (!modifiers) return clampPrompt(FULL_BODY_SWAP_PROMPT);
    return clampPrompt(`${FULL_BODY_SWAP_PROMPT} ${modifiers}`);
  }
  if (savedPrompt.trim()) return clampPrompt(savedPrompt);
  return clampPrompt(DEFAULT_PROMPTS[mode]);
}
