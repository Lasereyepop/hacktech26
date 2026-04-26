---
name: targeted-canvas-edit
description: Use this when an agent needs to edit existing canvas nodes without rebuilding the page or disturbing image artifacts.
---

# Targeted Canvas Edit

Use this for comment and inspector edits that should patch the current design document in place.

Inputs:
- `editContext.viewId`
- `editContext.targetNodeIds`
- `editContext.directNodeIds`
- `editContext.targetResolution`
- `editContext.imageEditIntent`
- `editContext.nodes`

Mutation rules:
- Treat `targetNodeIds` as the hard edit boundary.
- Preserve unrelated nodes exactly.
- Preserve every image node's `artifactKey`.
- Text, copy, navigation, and top-bar requests should mutate only text or button nodes.
- Spacing and visual-style requests may adjust target text, button, or shape style/bounds.
- Image/media requests may mutate an image node only when `imageEditIntent` is true and the image is a direct target.
- If the target is unresolved, fail closed by preserving the canvas and recording metadata.

Guard checks before persistence:
- Do not add or remove nodes.
- Do not remove IDs from a view.
- Do not replace the whole view.
- Do not clear image `artifactKey`.
- Do not change nodes outside the target set.
- Do not leave screenshots, reference artifacts, prompt traces, or artifact labels as website content.

Fallback behavior:
- If the requested edit cannot be represented safely as a targeted patch, preserve the current document and record the edit as guarded/rejected metadata.
