# Operational interface guidelines

Paw Patrol is a working dispatch console. Prioritize the map, people, observations,
and the next available action. Use the shared palette in `app/operations.css` for
command, officer, and access screens.

- Use a clear hierarchy: workspace heading, section heading, data, supporting text.
  Reserve large numerals for values that help an operator assess the current state.
- Prefer rectangular work areas, ruled lists, and open sections. Add a panel border
  only when content needs a boundary; avoid nesting cards inside cards.
- Use small corner radii on controls. Reserve shadows for overlays and dialogs.
  Avoid decorative gradients, glass reflections, entrance animations, and glows.
- Keep neutral text and surfaces dominant. Gold identifies actions and selection;
  green identifies an available state. Warning color must communicate actual status.
- Keep measurements tabular and their units and source visible. Do not animate a
  measurement in a way that suggests a sensor is reporting more than it is.
- Keep simulation labels, observation age, missing-data states, and review warnings.
  Never use visual polish to imply evidence is confirmed or a device is connected.
- Put persistent information in the document flow. Floating overlays must not cover
  other controls, especially on phones. Keep map controls attached to the map.
- Reflow at narrow widths; do not shrink the interface to fit. Preserve visible focus,
  descriptive labels, contrast, reduced-motion behavior, and forced-color support.
- Review dark and light themes at desktop and phone widths. Exercise search,
  selection, theme switching, and disclosure controls after layout changes.

These guidelines concern presentation only. API routes, authentication, incident
publication, sensor behavior, and response logic are outside a visual redesign.
