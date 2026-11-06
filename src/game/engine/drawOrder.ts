/*
 * Kept apart from `createRun` so the running game does not pull in the run
 * factory and the map generator, which load only when a new run is created.
 * Orders are drawn to fit the settlement and offered as choices; the logic
 * lives with the rest of the Queen's orders.
 */
export { drawOrder } from './orders'
