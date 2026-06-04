# Compactor Draft Repo Guidance

This is an example of the kind of root guidance Compactor generates after mining repeated commit history.

## Repository guidance
- Start from the nearest existing implementation before introducing a new pattern.
- Keep generated agent instructions short, concrete, and tied to repository evidence.
- Validate changes with the commands listed in the matching skill draft.

## Candidate skills
- Add or Update Backend API Feature: use `.compactor/skills/add-or-update-backend-api-feature/SKILL.md` when work matches `api_route_changed`, `service_layer_changed`, and test signals.
- Update Build or CI Configuration: use `.compactor/skills/update-build-or-ci-configuration/SKILL.md` when work matches `ci_changed` and `config_changed`.

## Scan summary
- Commits analyzed: 25
- Repeated path patterns: 8
