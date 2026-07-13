# Visual Interpolation And Applicability Matrix

## Status

- Candidate: semantic operations
- Date: 2026-07-12
- Selection authority: none

This matrix classifies visual values by meaning. An adapter may choose an implementation strategy, but
it may not invent interpolation for an unsupported pair or silently replace a diagnosed transition.

## Common Rule

Every target change has exactly one of three resolutions:

1. **continuous**: one normative interpolation exists for the value pair;
2. **topology-conditional**: interpolation is continuous only when the endpoints have compatible
   structure;
3. **discrete**: the value switches at the target scene boundary. Visual blending requires two
   declared presentation identities with coordinated opacity and presence; it is not hidden inside
   the value.

Transition policy controls time, interruption, and reduced motion. It never changes this compatibility
classification. Incompatible endpoints fail before a retained channel starts.

## Matrix

| Value                                   | Resolution           | Compatibility law                                                                                                                        |
| --------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Number, length, angle, time             | continuous           | same dimension; angle follows the declared shortest-arc operation where rotational                                                       |
| Opacity and normalized ratios           | continuous           | finite scalar; target-specific domain validation still applies                                                                           |
| Color                                   | continuous           | OKLCH, shorter hue arc, premultiplied alpha                                                                                              |
| Solid paint                             | continuous           | solid to solid; interpolate color                                                                                                        |
| Gradient paint                          | topology-conditional | same gradient kind and stop count; corresponding positions/colors interpolate; center/radius/typed angle interpolate                     |
| Different paint kinds                   | discrete             | use explicit generated layers with coordinated opacity and presence when blending is intended                                            |
| Rectangle shape                         | continuous           | rectangle to rectangle; corresponding logical radii and smoothing interpolate                                                            |
| Vector path                             | topology-conditional | same view-box semantics, fill rule, command count, and ordered command kinds                                                             |
| Capsule, ellipse, or unlike shape kinds | discrete             | no implicit path conversion; explicit morph source or crossfade required                                                                 |
| Stroke                                  | topology-conditional | both present; same placement, dash presence/count, and compatible paint                                                                  |
| Stroke and `none`                       | discrete             | explicit layer/presence transition required                                                                                              |
| Shadow list                             | topology-conditional | same list length and corresponding inner/outer kind; all fields interpolate                                                              |
| Material                                | topology-conditional | both present and tint paint compatible; blur, saturation, tint, and noise interpolate                                                    |
| Material and `none`                     | discrete             | explicit layer/presence transition required                                                                                              |
| Type style                              | topology-conditional | same families, alignment, wrapping, overflow, decoration, and variation-axis keys; numeric metrics interpolate and participate in layout |
| Media fit                               | topology-conditional | same fit mode; focal point interpolates                                                                                                  |
| Transform                               | continuous           | component translation/scale/origin, quaternion rotation, reciprocal perspective                                                          |
| Layout geometry                         | retained geometry    | position plus log-size channels retarget from presented geometry; never generic value interpolation                                      |
| Focus, caret, selection, placeholder    | capability-scoped    | value law follows paint/type target, but only structure-issued capabilities expose the target                                            |

## Applicability

- Drawing identities expose paint, shape, stroke, shadows, material, opacity, transform, and geometry.
- Text-bearing semantic parts additionally expose type style; generated drawing layers do not.
- Structure-owned media exposes media fit; a drawing layer cannot invent media semantics.
- Focus and text-entry appearance exists only through structure-issued capabilities.
- Masks are composition relationships, not paint values.
- A value pair classified as discrete does not make the target invalid. Applying a continuous policy to
  that pair is invalid unless the preset explicitly supplies a different visual relationship.

## Required Proof

- Type fixtures reject plain gradient angles and incompatible target kinds.
- Reference/property tests cover every continuous and topology-conditional row.
- Mutation tests kill removed topology checks and changed interpolation laws.
- Two independent adapters agree on endpoints and intermediate samples.
- Static and retained web lowerings either satisfy the row or report an unsupported capability.
