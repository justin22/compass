# Contributing to Compass

Thanks for helping make Compass better.

Compass is deliberately small: plain JavaScript modules, no build step and no
dependencies. Keep changes focused and match the code around them. Do not add
TypeScript, a bundler or packages.

## Before you start

For a substantial feature or behaviour change, open an issue first so the idea
can be discussed before you spend time building it. Small fixes can go straight
to a pull request.

## Make and test your change

1. Fork and clone the repository.
2. Load the folder as an unpacked extension from `chrome://extensions`.
3. Make the smallest change that solves the problem.
4. Run the automated check:

   ```
   node archive.test.mjs
   ```

5. Run `node --check <file>.js` for every JavaScript file you changed.
6. Reload Compass from `chrome://extensions`, refresh any existing test pages,
   and try the affected behaviour in a Chromium browser.
7. Update the README if the user-visible behaviour changed.

## Show the impact

A short video is required for every user-visible change. Attach it to the pull
request or link to it from the description. Keep it focused and show:

- the behaviour before the change, when that is useful;
- the new behaviour after the change;
- the command bar and sidebar if the change affects both;
- any important keyboard or pointer interaction.

Use a clean browser profile and avoid recording personal tabs, bookmarks,
history, account details or notifications.

For documentation, tests or internal-only changes, write `Not user-visible` in
the video section and explain why a recording would not add anything.

## Open the pull request

Use the pull request template. Explain what changed, why it changed and how you
tested it. Keep unrelated changes out of the pull request.

By contributing, you agree that your contribution is licensed under the MIT
License.
