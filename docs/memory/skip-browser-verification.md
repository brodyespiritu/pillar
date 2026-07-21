---
name: skip-browser-verification
description: "Don't drive the browser to verify every build on Pillar — just build, confirm the build passes, and tell the user what to check"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fdeb5a91-334c-43dd-a52f-6a18d2214770
---

On the Pillar app, do NOT use the Claude browser (preview_start / PIN login / screenshots) to visually verify after every build. The PIN-login loop is slow and flaky and the user finds it wasteful.

**Why:** the user asked to stop verifying each build in-browser and instead just be told what to check themselves.

**How to apply:** After a change, run `npm run build` to confirm it compiles, then tell the user in plain text what to look at (which page/tab/flow) and any SQL they still need to run. Only open the browser if the user explicitly asks for a screenshot/visual check or to debug something that can't be reasoned about from the code.

Related: [[pillar-design-reference]], [[calendly-ui-ux-system]].
