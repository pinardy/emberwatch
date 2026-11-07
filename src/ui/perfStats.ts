/**
 * Numbers the 3D map's renderer reports for the performance readout. The
 * probe inside the 3D scene (mounted only while the readout is on) writes
 * them; the readout reads them. Null while no 3D scene is measuring.
 */
export const perfStats: { drawCalls: number | null } = { drawCalls: null }
