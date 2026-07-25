// Fixed simulation rate. The Rapier <Physics> timeStep and the flight
// controller's dt must match this so control math stays consistent.
export const SIM_HZ = 250;
export const SIM_DT = 1 / SIM_HZ;

export const GRAVITY = 9.81; // m/s^2
