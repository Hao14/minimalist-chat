# Minimalist Chat contributor guidance

## UI development

- Reuse the existing React components, authored CSS, design tokens, and Phosphor icon set before introducing another UI runtime.
- When `npm run storybook` is running, use the `minimalist_storybook` MCP tools to inspect documented components and run story tests before changing shared UI.
- Use the `shadcn` and `magicui` MCP servers for discovery and source review. Do not run `shadcn init`, import a registry component, add Tailwind, or add a second icon system unless the current task explicitly adopts that dependency.
- Port useful external patterns into the existing JSX/CSS conventions and preserve reduced-motion, responsive, accessibility, and performance behavior.

## UI verification

- Run `npm run test-storybook` for documented component changes.
- Run `npm run build-storybook` after changing Storybook configuration.
- Keep Storybook bound to `127.0.0.1`; its MCP endpoint is development-only.
- Continue to run the existing relevant audit scripts for application behavior. Storybook tests supplement rather than replace the app test suite.
