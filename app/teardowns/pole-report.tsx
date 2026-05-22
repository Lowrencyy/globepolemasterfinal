// Dedicated route for Pole Report mode.
// Reuses the pole-detail implementation, but lets us navigate to a distinct screen
// from poles.tsx so pole_report flows don't carry "teardown" semantics.

export { PoleDetailScreen as default } from "./pole-detail";

