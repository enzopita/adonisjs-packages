---
'@enzopita/adonisjs-openapi': patch
---

Generate the document faster, with the same output:

- `openapi:generate` and `openapi:check` start parsing the app's program on a worker thread before the app boots, so the TypeScript compiler parses the app's sources while the app boots. The document comes out byte for byte the same.
- Both commands enable the compile cache of Node, so later runs load the app and the 9 MB TypeScript compiler from compiled code.
- The lookup of a function passed to `.use()`, such as a `limiter.define()` throttle, no longer pays for the TypeScript compiler's source in the inspector.
- After a run outside CI, a background process saves the parsed program as a V8 startup snapshot in `node_modules/.cache/adonisjs-openapi`. Later runs start from it and parse only the files that changed, which saves about 0.8 s on a small app. A snapshot that fails to build or to start is neither used nor rebuilt for a day. `ADONISJS_OPENAPI_CACHE=false` turns it off, and an absolute path moves it to a folder that several apps can share.
- The declaration files of the app's dependencies parse without their doc comments, and a file parses them when the document reads one.
