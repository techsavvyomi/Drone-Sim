import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';

/**
 * 100% Solid Analytical Physics Colliders for New York City.
 * - Every single building block is a 100% solid discrete RigidBody (ZERO pass-through).
 * - Facades aligned with street curbs (ZERO phantom collisions in streets).
 * - Restitution = 0 across all colliders (ZERO rubber-ball bouncing on crash).
 * - Deep 20m solid foundation floor & raised sidewalks.
 */

// 18 calibrated solid building volume colliders strictly matched to visual geometry
const BUILDING_BLOCKS: Array<{ id: string; pos: [number, number, number]; args: [number, number, number] }> = [
  {
    "id": "FarWest_North",
    "pos": [
      -95.5,
      40.84,
      -62.32
    ],
    "args": [
      7.46,
      40.84,
      16.25
    ],
    "realHeight": "81.7m"
  },
  {
    "id": "FarWest_Center",
    "pos": [
      -94.54,
      24.26,
      0.99
    ],
    "args": [
      6.24,
      24.26,
      16.06
    ],
    "realHeight": "48.5m"
  },
  {
    "id": "FarWest_South",
    "pos": [
      -95.63,
      42.06,
      60.1
    ],
    "args": [
      7.46,
      42.06,
      16.42
    ],
    "realHeight": "84.1m"
  },
  {
    "id": "MidWest_North",
    "pos": [
      -60.98,
      49.76,
      -63.63
    ],
    "args": [
      17,
      49.76,
      17.56
    ],
    "realHeight": "99.5m"
  },
  {
    "id": "MidWest_Center",
    "pos": [
      -60.88,
      32.07,
      -0.19
    ],
    "args": [
      16.93,
      32.07,
      17.1
    ],
    "realHeight": "64.1m"
  },
  {
    "id": "MidWest_South",
    "pos": [
      -59.88,
      46.92,
      59.25
    ],
    "args": [
      17.93,
      46.92,
      15.8
    ],
    "realHeight": "93.8m"
  },
  {
    "id": "CentralWest_North",
    "pos": [
      -12.17,
      43.91,
      -60.56
    ],
    "args": [
      7.67,
      43.91,
      21.76
    ],
    "realHeight": "87.8m"
  },
  {
    "id": "CentralWest_Center",
    "pos": [
      -9.45,
      56.07,
      -0.56
    ],
    "args": [
      5.55,
      56.07,
      15.93
    ],
    "realHeight": "112.1m"
  },
  {
    "id": "CentralWest_South",
    "pos": [
      -10.44,
      35.23,
      61.7
    ],
    "args": [
      6.51,
      35.23,
      18.64
    ],
    "realHeight": "70.5m"
  },
  {
    "id": "CentralEast_North",
    "pos": [
      11.61,
      37.81,
      -60.56
    ],
    "args": [
      7.38,
      37.81,
      21.76
    ],
    "realHeight": "75.6m"
  },
  {
    "id": "CentralEast_Center",
    "pos": [
      8.08,
      56.07,
      -0.56
    ],
    "args": [
      4.09,
      56.07,
      12.36
    ],
    "realHeight": "112.1m"
  },
  {
    "id": "CentralEast_South",
    "pos": [
      10.25,
      34.84,
      63.17
    ],
    "args": [
      6.43,
      34.84,
      20.11
    ],
    "realHeight": "69.7m"
  },
  {
    "id": "MidEast_North",
    "pos": [
      60.59,
      31.69,
      -62.58
    ],
    "args": [
      18.89,
      31.69,
      18.68
    ],
    "realHeight": "63.4m"
  },
  {
    "id": "MidEast_Center",
    "pos": [
      60.54,
      24.81,
      1.64
    ],
    "args": [
      18.84,
      24.81,
      18.99
    ],
    "realHeight": "49.6m"
  },
  {
    "id": "MidEast_South",
    "pos": [
      60.55,
      28.77,
      60.65
    ],
    "args": [
      18.85,
      28.77,
      17.91
    ],
    "realHeight": "57.5m"
  },
  {
    "id": "FarEast_North",
    "pos": [
      95.59,
      32.07,
      -60.98
    ],
    "args": [
      7.25,
      32.07,
      16.37
    ],
    "realHeight": "64.1m"
  },
  {
    "id": "FarEast_Center",
    "pos": [
      96.72,
      24.56,
      1.97
    ],
    "args": [
      7.76,
      24.56,
      18.65
    ],
    "realHeight": "49.1m"
  },
  {
    "id": "FarEast_South",
    "pos": [
      95.5,
      25.3,
      61.34
    ],
    "args": [
      7.45,
      25.3,
      17.93
    ],
    "realHeight": "50.6m"
  }
];

// Rooftop landing floors (34 plates)
const ROOFTOP_PLATES: Array<{ pos: [number, number, number]; args: [number, number, number] }> = [
  {
    "pos": [
      52.73,
      61.08,
      -60.56
    ],
    "args": [
      9.89,
      0.05,
      14.78
    ]
  },
  {
    "pos": [
      -58.17,
      91.07,
      52.74
    ],
    "args": [
      14.49,
      0.05,
      7.86
    ]
  },
  {
    "pos": [
      -7.28,
      75.07,
      3.1
    ],
    "args": [
      3.65,
      0.05,
      8.8
    ]
  },
  {
    "pos": [
      -4.08,
      75.07,
      -9.36
    ],
    "args": [
      6.85,
      0.05,
      3.66
    ]
  },
  {
    "pos": [
      -4.08,
      75.07,
      -0.56
    ],
    "args": [
      6.85,
      0.05,
      12.46
    ]
  },
  {
    "pos": [
      6.43,
      75.07,
      -4.22
    ],
    "args": [
      3.65,
      0.05,
      8.8
    ]
  },
  {
    "pos": [
      3.23,
      75.07,
      -0.56
    ],
    "args": [
      6.85,
      0.05,
      12.46
    ]
  },
  {
    "pos": [
      3.23,
      75.07,
      8.24
    ],
    "args": [
      6.85,
      0.05,
      3.66
    ]
  },
  {
    "pos": [
      -84.33,
      81.07,
      -60.68
    ],
    "args": [
      14.44,
      0.05,
      12.61
    ]
  },
  {
    "pos": [
      -84.33,
      81.07,
      -62.49
    ],
    "args": [
      14.44,
      0.05,
      14.42
    ]
  },
  {
    "pos": [
      -84.34,
      66.06,
      -60.62
    ],
    "args": [
      15.44,
      0.05,
      13.55
    ]
  },
  {
    "pos": [
      -84.34,
      66.06,
      -62.55
    ],
    "args": [
      15.44,
      0.05,
      15.48
    ]
  },
  {
    "pos": [
      -86.58,
      60.07,
      53.06
    ],
    "args": [
      14.2,
      0.05,
      7.47
    ]
  },
  {
    "pos": [
      -86.58,
      60.07,
      53.06
    ],
    "args": [
      14.2,
      0.05,
      7.47
    ]
  },
  {
    "pos": [
      -8.72,
      57.07,
      3.69
    ],
    "args": [
      4.26,
      0.05,
      10.24
    ]
  },
  {
    "pos": [
      -4.68,
      57.07,
      -10.8
    ],
    "args": [
      8.29,
      0.05,
      4.25
    ]
  },
  {
    "pos": [
      -4.68,
      57.07,
      -0.56
    ],
    "args": [
      8.29,
      0.05,
      14.49
    ]
  },
  {
    "pos": [
      7.87,
      57.07,
      -4.81
    ],
    "args": [
      4.26,
      0.05,
      10.24
    ]
  },
  {
    "pos": [
      3.83,
      57.07,
      -0.56
    ],
    "args": [
      8.29,
      0.05,
      14.49
    ]
  },
  {
    "pos": [
      3.83,
      57.07,
      9.68
    ],
    "args": [
      8.29,
      0.05,
      4.25
    ]
  },
  {
    "pos": [
      -84.34,
      51.07,
      -60.57
    ],
    "args": [
      16.44,
      0.05,
      14.49
    ]
  },
  {
    "pos": [
      -84.34,
      51.07,
      -62.62
    ],
    "args": [
      16.44,
      0.05,
      16.55
    ]
  },
  {
    "pos": [
      52.74,
      33.11,
      56.24
    ],
    "args": [
      9.6,
      0.05,
      11.3
    ]
  },
  {
    "pos": [
      52.74,
      33.11,
      56.24
    ],
    "args": [
      9.6,
      0.05,
      11.3
    ]
  },
  {
    "pos": [
      91.16,
      30.1,
      72.33
    ],
    "args": [
      9.6,
      0.05,
      4.77
    ]
  },
  {
    "pos": [
      91.16,
      30.1,
      72.33
    ],
    "args": [
      9.6,
      0.05,
      4.77
    ]
  },
  {
    "pos": [
      52.74,
      60.07,
      -60.56
    ],
    "args": [
      9.6,
      0.05,
      14.5
    ]
  },
  {
    "pos": [
      52.74,
      60.07,
      -60.56
    ],
    "args": [
      9.6,
      0.05,
      14.5
    ]
  },
  {
    "pos": [
      -0.42,
      39,
      56.22
    ],
    "args": [
      15.62,
      0.05,
      13.16
    ]
  },
  {
    "pos": [
      -0.42,
      39,
      56.22
    ],
    "args": [
      15.62,
      0.05,
      13.16
    ]
  },
  {
    "pos": [
      9.84,
      24.1,
      74.81
    ],
    "args": [
      4.34,
      0.05,
      5.53
    ]
  },
  {
    "pos": [
      9.84,
      24.1,
      74.81
    ],
    "args": [
      4.34,
      0.05,
      5.53
    ]
  },
  {
    "pos": [
      71.94,
      36.1,
      -78.16
    ],
    "args": [
      9.6,
      0.05,
      3.1
    ]
  },
  {
    "pos": [
      71.94,
      36.1,
      -78.16
    ],
    "args": [
      9.6,
      0.05,
      3.1
    ]
  }
];

// Raised sidewalk landing plates (31 plates at Y = 0.12m)
const SIDEWALK_PLATES: Array<{ pos: [number, number, number]; args: [number, number, number] }> = [
  {
    "pos": [
      -107.25,
      0.06,
      24.95
    ],
    "args": [
      1.53,
      0.06,
      1.86
    ]
  },
  {
    "pos": [
      -110.66,
      0.06,
      -39.58
    ],
    "args": [
      1.88,
      0.06,
      1.51
    ]
  },
  {
    "pos": [
      -37.48,
      0.06,
      -39.57
    ],
    "args": [
      1.51,
      0.06,
      1.51
    ]
  },
  {
    "pos": [
      32.88,
      0.06,
      61.5
    ],
    "args": [
      1.51,
      0.06,
      25.31
    ]
  },
  {
    "pos": [
      32.88,
      0.06,
      60
    ],
    "args": [
      1.51,
      0.06,
      26.81
    ]
  },
  {
    "pos": [
      -22.84,
      0.06,
      60.38
    ],
    "args": [
      1.88,
      0.06,
      23.43
    ]
  },
  {
    "pos": [
      -37.5,
      0.06,
      58.57
    ],
    "args": [
      1.53,
      0.06,
      21.48
    ]
  },
  {
    "pos": [
      -37.5,
      0.06,
      60.07
    ],
    "args": [
      1.53,
      0.06,
      22.98
    ]
  },
  {
    "pos": [
      -107.25,
      0.06,
      0
    ],
    "args": [
      1.53,
      0.06,
      26.82
    ]
  },
  {
    "pos": [
      -107.25,
      0.06,
      1.88
    ],
    "args": [
      1.53,
      0.06,
      24.94
    ]
  },
  {
    "pos": [
      -110.66,
      0.06,
      -60.94
    ],
    "args": [
      1.88,
      0.06,
      22.87
    ]
  },
  {
    "pos": [
      -37.48,
      0.06,
      -62.43
    ],
    "args": [
      1.51,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      -110.66,
      0.06,
      -62.44
    ],
    "args": [
      1.88,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      71.94,
      0.06,
      1.31
    ],
    "args": [
      33.82,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      71.94,
      0.06,
      1.31
    ],
    "args": [
      33.82,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      71.94,
      0.06,
      -62.43
    ],
    "args": [
      33.82,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      71.94,
      0.06,
      -62.43
    ],
    "args": [
      33.82,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      70.07,
      0.06,
      60
    ],
    "args": [
      35.69,
      0.06,
      26.81
    ]
  },
  {
    "pos": [
      70.07,
      0.06,
      60
    ],
    "args": [
      35.69,
      0.06,
      26.81
    ]
  },
  {
    "pos": [
      -0.42,
      0.06,
      -60.56
    ],
    "args": [
      24.3,
      0.06,
      23.25
    ]
  },
  {
    "pos": [
      -0.42,
      0.06,
      -60.56
    ],
    "args": [
      24.3,
      0.06,
      23.25
    ]
  },
  {
    "pos": [
      -0.42,
      0.06,
      -2.43
    ],
    "args": [
      21.3,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      -0.42,
      0.06,
      -2.43
    ],
    "args": [
      21.3,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      -0.42,
      0.06,
      60.38
    ],
    "args": [
      20.54,
      0.06,
      23.43
    ]
  },
  {
    "pos": [
      -2.3,
      0.06,
      60.38
    ],
    "args": [
      22.42,
      0.06,
      23.43
    ]
  },
  {
    "pos": [
      -72.4,
      0.06,
      60.07
    ],
    "args": [
      33.43,
      0.06,
      22.98
    ]
  },
  {
    "pos": [
      -72.4,
      0.06,
      60.56
    ],
    "args": [
      33.43,
      0.06,
      22.48
    ]
  },
  {
    "pos": [
      -72.35,
      0.06,
      -0.49
    ],
    "args": [
      33.43,
      0.06,
      26.33
    ]
  },
  {
    "pos": [
      -72.35,
      0.06,
      0
    ],
    "args": [
      33.43,
      0.06,
      26.82
    ]
  },
  {
    "pos": [
      -73.87,
      0.06,
      -62.43
    ],
    "args": [
      34.9,
      0.06,
      24.37
    ]
  },
  {
    "pos": [
      -74.25,
      0.06,
      -62.44
    ],
    "args": [
      35.28,
      0.06,
      24.37
    ]
  }
];

// Street light & traffic poles (36 cylinders)
const STREET_POLES: Array<{ pos: [number, number, number]; halfH: number; radius: number }> = [
  {
    "pos": [
      101.63,
      2.25,
      -85.62
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -66.68,
      2.25,
      81.75
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -107.68,
      2.25,
      62.22
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -79.11,
      2.25,
      81.78
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      21.98,
      2.25,
      19.59
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      37.47,
      2.25,
      23.8
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      33.27,
      2.25,
      35.54
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      106.87,
      2.25,
      23.34
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      21.52,
      2.25,
      -24.92
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -110.65,
      2.25,
      -84.46
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      21.52,
      2.25,
      -84.92
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -22.83,
      2.25,
      -84.46
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -110.18,
      2.25,
      -39.96
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      21.98,
      2.25,
      -36.66
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -22.38,
      2.25,
      20.05
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      37.02,
      2.25,
      -84.46
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -106.9,
      2.25,
      -24.47
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -22.83,
      2.25,
      -24.46
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -107.5,
      2.25,
      75.36
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      107.51,
      2.25,
      -46.32
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      107.73,
      2.25,
      -74.6
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      36.35,
      2.25,
      12.5
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      36.29,
      2.25,
      -59.3
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      36.24,
      2.25,
      -75.35
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -55.58,
      2.25,
      81.87
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      107.64,
      2.25,
      -60.09
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      36.43,
      2.25,
      -1.04
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      77.28,
      2.25,
      -85.55
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -90.2,
      2.25,
      82.06
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -43.69,
      2.25,
      81.98
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      89.23,
      2.25,
      -86.3
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      54.65,
      2.25,
      -86.3
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      35.63,
      2.25,
      -46.06
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      35.63,
      2.25,
      -15.05
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -100.78,
      2.25,
      82.55
    ],
    "halfH": 2.25,
    "radius": 0.35
  },
  {
    "pos": [
      -108.28,
      2.25,
      46.12
    ],
    "halfH": 2.25,
    "radius": 0.35
  }
];

// Sidewalk tree trunks (76 cylinders)
const TREE_TRUNKS: Array<{ pos: [number, number, number]; halfH: number; radius: number }> = [
  {
    "pos": [
      -49.35,
      4,
      40.72
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -80.19,
      4,
      19.25
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      72.11,
      4,
      40.37
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      102.92,
      4,
      -19.61
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -57.36,
      4,
      -41.55
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      48.66,
      4,
      -41.56
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -39.19,
      4,
      59.58
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -87.08,
      4,
      79.84
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -105.57,
      4,
      -68.33
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -80.34,
      4,
      40.88
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -42.42,
      4,
      40.36
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -71.99,
      4,
      19.38
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      94.69,
      4,
      -19.9
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      56.15,
      4,
      -19.89
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -87.17,
      4,
      -41.25
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -49.13,
      4,
      -41.27
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      80.13,
      4,
      -41.27
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      41.5,
      4,
      -41.23
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -105.62,
      4,
      60.97
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -49.2,
      4,
      79.88
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      102.25,
      4,
      40.13
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      63.86,
      4,
      39.69
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -106.48,
      4,
      76.68
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -72.76,
      4,
      80.75
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -102.38,
      4,
      40.34
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -95.58,
      4,
      20.6
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -57.56,
      4,
      20
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -72.73,
      4,
      -40.42
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -39.43,
      4,
      69.04
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -105.3,
      4,
      51.85
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -95.61,
      3.91,
      79.65
    ],
    "halfH": 3.91,
    "radius": 0.4
  },
  {
    "pos": [
      -57.75,
      4,
      79.51
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -105.29,
      4,
      -61.09
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -87.05,
      4,
      41.26
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -42.57,
      4,
      18.63
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      64.76,
      4,
      -19.56
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -95.67,
      4,
      -41.54
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      86.78,
      4,
      -41.61
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      95.05,
      4,
      39.95
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -38.85,
      2.96,
      42.84
    ],
    "halfH": 2.96,
    "radius": 0.4
  },
  {
    "pos": [
      -105.92,
      3.05,
      -43.85
    ],
    "halfH": 3.05,
    "radius": 0.4
  },
  {
    "pos": [
      -64.97,
      3.17,
      40.34
    ],
    "halfH": 3.17,
    "radius": 0.4
  },
  {
    "pos": [
      87.12,
      3.12,
      39.81
    ],
    "halfH": 3.12,
    "radius": 0.4
  },
  {
    "pos": [
      48.61,
      3.01,
      39.81
    ],
    "halfH": 3.01,
    "radius": 0.4
  },
  {
    "pos": [
      79.41,
      3.27,
      -20.2
    ],
    "halfH": 3.27,
    "radius": 0.4
  },
  {
    "pos": [
      40.88,
      3.37,
      -20.2
    ],
    "halfH": 3.37,
    "radius": 0.4
  },
  {
    "pos": [
      102.98,
      3.1,
      -40.93
    ],
    "halfH": 3.1,
    "radius": 0.4
  },
  {
    "pos": [
      64.46,
      2.99,
      -40.94
    ],
    "halfH": 2.99,
    "radius": 0.4
  },
  {
    "pos": [
      -38.99,
      4,
      51.56
    ],
    "halfH": 4,
    "radius": 0.4
  },
  {
    "pos": [
      -87.62,
      2.35,
      19.8
    ],
    "halfH": 2.35,
    "radius": 0.4
  },
  {
    "pos": [
      -49.62,
      2.44,
      19.25
    ],
    "halfH": 2.44,
    "radius": 0.4
  },
  {
    "pos": [
      56.53,
      2.69,
      39.94
    ],
    "halfH": 2.69,
    "radius": 0.4
  },
  {
    "pos": [
      87.35,
      2.31,
      -20.06
    ],
    "halfH": 2.31,
    "radius": 0.4
  },
  {
    "pos": [
      71.94,
      2.35,
      -20.06
    ],
    "halfH": 2.35,
    "radius": 0.4
  },
  {
    "pos": [
      71.94,
      2.47,
      -41.06
    ],
    "halfH": 2.47,
    "radius": 0.4
  },
  {
    "pos": [
      56.54,
      2.22,
      -41.06
    ],
    "halfH": 2.22,
    "radius": 0.4
  },
  {
    "pos": [
      -38.98,
      2.31,
      77.05
    ],
    "halfH": 2.31,
    "radius": 0.4
  },
  {
    "pos": [
      -105.79,
      2.67,
      44.12
    ],
    "halfH": 2.67,
    "radius": 0.4
  },
  {
    "pos": [
      -57.13,
      2.83,
      40.36
    ],
    "halfH": 2.83,
    "radius": 0.4
  },
  {
    "pos": [
      -102.78,
      2.85,
      -41.08
    ],
    "halfH": 2.85,
    "radius": 0.4
  },
  {
    "pos": [
      -79.98,
      2.81,
      -41.08
    ],
    "halfH": 2.81,
    "radius": 0.4
  },
  {
    "pos": [
      48.84,
      2.38,
      -20.06
    ],
    "halfH": 2.38,
    "radius": 0.4
  },
  {
    "pos": [
      -105.79,
      2.47,
      68.82
    ],
    "halfH": 2.47,
    "radius": 0.4
  },
  {
    "pos": [
      -41.98,
      2.17,
      80.05
    ],
    "halfH": 2.17,
    "radius": 0.4
  },
  {
    "pos": [
      79.65,
      2.27,
      39.95
    ],
    "halfH": 2.27,
    "radius": 0.4
  },
  {
    "pos": [
      -64.78,
      2.48,
      -41.07
    ],
    "halfH": 2.48,
    "radius": 0.4
  },
  {
    "pos": [
      -102.78,
      3.19,
      80.05
    ],
    "halfH": 3.19,
    "radius": 0.4
  },
  {
    "pos": [
      -79.98,
      1.96,
      80.05
    ],
    "halfH": 1.96,
    "radius": 0.4
  },
  {
    "pos": [
      -105.79,
      2.33,
      -77.06
    ],
    "halfH": 2.33,
    "radius": 0.4
  },
  {
    "pos": [
      -95.14,
      2.71,
      40.92
    ],
    "halfH": 2.71,
    "radius": 0.4
  },
  {
    "pos": [
      -72.34,
      2.92,
      40.59
    ],
    "halfH": 2.92,
    "radius": 0.4
  },
  {
    "pos": [
      -102.82,
      2.08,
      20.02
    ],
    "halfH": 2.08,
    "radius": 0.4
  },
  {
    "pos": [
      -64.82,
      2.14,
      19.47
    ],
    "halfH": 2.14,
    "radius": 0.4
  },
  {
    "pos": [
      -41.98,
      2.9,
      -41.07
    ],
    "halfH": 2.9,
    "radius": 0.4
  },
  {
    "pos": [
      41.13,
      1,
      39.95
    ],
    "halfH": 1,
    "radius": 0.4
  },
  {
    "pos": [
      95.05,
      1.02,
      -41.06
    ],
    "halfH": 1.02,
    "radius": 0.4
  }
];

export function NewYorkColliders() {
  return (
    <group name="new-york-colliders-group">
      {/* 1. Deep solid underground foundation floor (Top face on Y = 0.000m, 20m underground) */}
      <RigidBody type="fixed" colliders={false} name="nyc-ground-floor">
        <CuboidCollider args={[3000, 10, 3000]} position={[0, -10, 0]} friction={0.8} restitution={0} />
      </RigidBody>

      {/* 2. Raised sidewalk landing plates (Top face at Y = +0.12m) */}
      <RigidBody type="fixed" colliders={false} name="nyc-sidewalks">
        {SIDEWALK_PLATES.map((s, i) => (
          <CuboidCollider key={`sw-${i}`} args={s.args} position={s.pos} friction={0.8} restitution={0} />
        ))}
      </RigidBody>

      {/* 3. 18 Discrete Solid Building RigidBodies — each positioned at building center for optimal Rapier BVH */}
      {BUILDING_BLOCKS.map((b) => (
        <RigidBody
          key={`rb-${b.id}`}
          type="fixed"
          colliders={false}
          position={b.pos}
          name={`bldg-${b.id}`}
        >
          <CuboidCollider args={b.args} position={[0, 0, 0]} friction={0.8} restitution={0} />
        </RigidBody>
      ))}

      {/* 4. Rooftop landing floors */}
      <RigidBody type="fixed" colliders={false} name="nyc-rooftops">
        {ROOFTOP_PLATES.map((r, i) => (
          <CuboidCollider key={`r-${i}`} args={r.args} position={r.pos} friction={0.8} restitution={0} />
        ))}
      </RigidBody>

      {/* 5. Street light & traffic poles */}
      <RigidBody type="fixed" colliders={false} name="nyc-poles">
        {STREET_POLES.map((p, i) => (
          <CylinderCollider key={`pole-${i}`} args={[p.halfH, p.radius]} position={p.pos} friction={0.6} restitution={0} />
        ))}
      </RigidBody>

      {/* 6. Sidewalk tree trunks */}
      <RigidBody type="fixed" colliders={false} name="nyc-trees">
        {TREE_TRUNKS.map((t, i) => (
          <CylinderCollider key={`tree-${i}`} args={[t.halfH, t.radius]} position={t.pos} friction={0.6} restitution={0} />
        ))}
      </RigidBody>
    </group>
  );
}
