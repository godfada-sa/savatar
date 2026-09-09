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
