# Command Centre demo officer art

Generated with the built-in image-generation tool from the user's pixel-art style references. These fictional portraits are visual demo assets, not representations of real officers or verified identities.

Scope: `DispatchDashboard` roster only. Assets: `public/demo-officers/p-01.webp` through `p-15.webp`. Stable filenames follow the existing demo IDs; no shared officer records were changed. Each image was exported to 96 × 96 lossless WebP using nearest-neighbour resizing; original generated artwork is retained outside the repository.

## Generation prompts

### P-01

Use case: stylized-concept. Asset type: fictional police-officer demo avatar, one square raster portrait, to appear at 36px in a dashboard roster. Generate ONE distinct head-and-shoulders character, straight-on, centered, full navy-blue police cap visible, cropped upper shoulders at bottom. Coarse retro 16-bit pixel art, LARGE hard-edged square pixels like a 32x32 pixel sprite enlarged, extremely simple readable face and silhouette, flat colours, no gradients/antialiasing/detail/texture. Uniform muted blue cap with one small yellow geometric badge, blue shirt, black sunglasses. Subject variation 01: masculine-presenting adult, deep brown skin, short tightly curled black hair visible at sides, small black moustache, neutral friendly expression. Plain flat pale ice-blue background #eaf4fa, no border. Face and cap together fill 85% of square, only 6% headroom. Original fictional character, no resemblance to a real person. No words, initials, text, watermark, weapons, scene or extra objects. Aim stylistically at the user's simple blocky pixel-art police head examples, not realism.

### Shared prompt for P-02 through P-15

Use case: stylized-concept. Asset: ONE square pixel-art portrait for a fictional police officer demo roster, legible at 36px. Front-facing centered head and shoulders; entire navy-blue peaked police cap with simple yellow geometric badge, blue shirt. Retro 16-bit sprite, coarse LARGE crisp hard-edged square pixels like a 32x32 game avatar enlarged. Simple eyes and facial features, flat limited colours, no gradients or texture. Plain flat pale ice-blue background #eaf4fa. Face and hat fill 85% of square with 6% headroom; cropped shoulders at bottom. Original fictional adult, no real person. No words, initials, text, watermark, weapons, props or scene. Subject:

### Individual subjects

- **P-02:** feminine-presenting, fair peach skin, long golden-blonde ponytail visible on one side of cap, black square sunglasses, slight smile.
- **P-03:** masculine-presenting, warm tan skin, short dark-brown wavy hair at temples, neat dark goatee, visible dark eyes without glasses.
- **P-04:** feminine-presenting, deep dark-brown skin, black braided hair extending neatly beside shoulders, visible eyes without glasses, calm neutral smile.
- **P-05:** androgynous adult, light golden skin, straight black hair in short side-swept fringe under cap, small black round-framed clear glasses, no facial hair, neutral friendly expression.
- **P-06:** masculine-presenting older adult, fair skin, short silver-grey hair at temples, thick silver moustache, clear pale blue eyes, no glasses.
- **P-07:** feminine-presenting adult, medium brown skin, chestnut curly bob visible under cap, dark sunglasses, soft smile.
- **P-08:** androgynous adult, fair pink skin with a few freckles, short vivid copper red hair, dark green eyes without glasses, small smile, no facial hair.
- **P-09:** masculine-presenting adult, very deep brown skin, short neat black beard, black square-framed clear glasses, calm expression.
- **P-10:** feminine-presenting adult, olive tan skin, long dark-brown straight hair tucked behind shoulders, dark brown eyes without glasses, calm smile.
- **P-11:** masculine-presenting adult, medium golden brown skin, short black side-parted hair, clean-shaven face, black sunglasses, neutral friendly mouth.
- **P-12:** feminine-presenting older adult, warm brown skin, grey tightly curled hair at sides, black round-framed clear glasses, small relaxed smile.
- **P-13:** androgynous adult, light olive skin, short auburn bob haircut, dark eyes without glasses, no facial hair, relaxed expression.
- **P-14:** masculine-presenting adult, fair peach skin, short sandy-blond hair, short light-brown beard, dark sunglasses, small smile.
- **P-15:** feminine-presenting adult, deep brown skin, dark hair in a neat side bun visible at one side of cap, dark eyes without glasses, relaxed friendly mouth.

## UI semantics

Portraits are decorative beside the existing officer name and ID. Missing assets fall back to initials. Pixel-heart animation is a two-frame data-availability cue, not measured heartbeat timing or an ECG; reduced-motion disables it. Synthetic readings stay labelled demo. The selected profile's local device mode never falls back to synthetic BPM when its signal is absent. Watch/phone indicators must not infer a real connection from a demo sample, a name match, or an incident report.
