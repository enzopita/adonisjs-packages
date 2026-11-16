---
'@enzopita/adonisjs-openapi': patch
---

Document an object merged with a `vine.group()` as one complete object per group branch at every depth, not only as the whole body: in a property, in an array's items and in a group branch. `vine.array(vine.object({ text }).merge(group))` used to document its items as Vine's loose `anyOf: [group, object]`, which rejects a valid item holding keys of both and accepts one missing the group's keys.
