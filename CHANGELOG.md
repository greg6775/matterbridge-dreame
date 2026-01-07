# <img src="matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge plugin template changelog

All notable changes to this project will be documented in this file.

If you like this project and find it useful, please consider giving it a star on GitHub at https://github.com/Luligu/matterbridge-plugin-template and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/bmc-button.svg" alt="Buy me a coffee" width="120"></a>

All notable changes to this project will be documented in this file.

## [1.0.4] - 2025-12-23

### Added

- [DevContainer]: Refactored Dev Container setup. The Matterbridge instance can now be paired on native Linux hosts or WSL 2 with Docker engine CLI integration. On Docker Desktop on Windows or macOS is not possible cause Docker Desktop runs inside a VM and not directly on the host so mDNS is not supported.
- [DevContainer]: Since is now possible to pair from Dev Container, named volumes have been added to persist storage and plugins across rebuilds.

### Changed

- [package]: Updated dependencies.
- [package]: Updated to the current Matterbridge signatures.
- [package]: Requires Matterbridge v.3.4.0.
- [package]: Bumped package to automator v.2.1.0.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.3] - 2025-11-14

### Changed

- [package]: Updated dependencies.
- [package]: Bumped package to automator v.2.0.12.
- [jest]: Updated jestHelpers to v.1.0.12.
- [workflows]: Use shallow clones and --no-fund --no-audit for faster builds.
- [package]: Updated to the current Matterbridge signatures.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.2] - 2025-10-25

### Changed

- [package]: Bumped package to automator v. 2.0.9.
- [jest]: Updated jestHelpers to v. 1.0.9.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.1] - 2025-10-17

### Breaking Changes

- [node]: Requires node.js 20.x or 22.x or 24.x (LTS versions). Node.js 18.x is no longer supported.
- [platform]: Requires Matterbridge v.3.3.0.
- [platform]: Upgrade to the new PlatformMatterbridge signature.

### Changed

- [package]: Bumped package to automator version 2.0.8
- [workflows]: Ignore any .md in build.yaml.
- [workflows]: Ignore any .md in codeql.yaml.
- [workflows]: Ignore any .md in codecov.yaml.
- [template]: Updated bug_report.md.
- [jest]: Updated jestHelpers to v. 1.0.8.
- [workflows]: Improved speed on Node CI.
- [devcontainer]: Added the plugin name to the container.
- [devcontainer]: Improved performance of first build with shallow clone.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.0] - 2025-06-15

- First release of the Matterbridge plugin template

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

<!-- Commented out section
## [1.0.0] - 2025-07-01

### Added

- [Feature 1]: Description of the feature.
- [Feature 2]: Description of the feature.

### Changed

- [Feature 3]: Description of the change.
- [Feature 4]: Description of the change.

### Deprecated

- [Feature 5]: Description of the deprecation.

### Removed

- [Feature 6]: Description of the removal.

### Fixed

- [Bug 1]: Description of the bug fix.
- [Bug 2]: Description of the bug fix.

### Security

- [Security 1]: Description of the security improvement.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="bmc-button.svg" alt="Buy me a coffee" width="80">
</a>

-->
