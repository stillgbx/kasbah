// Responses CAPTURED from a real IQ Gateway Metered (software D8.3, THREE-PHASE installation:
// 20 microinverters, 2 IQ batteries of 5 kWh, production CT + net-consumption CT).
// Written from the real responses and not from the vendor's documentation: that is the lesson of
// TaHoma, where two bugs survived 19 green tests because the fixtures followed the spec.
//
// Serial numbers are replaced by fake, stable ones. Everything else is as the gateway sent it,
// quirks included:
//   - `/ivp/ensemble/power` carries its list under the key `"devices:"`, with a trailing COLON;
//   - powers in `livedata` and `ensemble/power` are in MILLIWATTS, those in `production.json` in
//     watts;
//   - `production.json` gives TWO production entries: `inverters` (sum of the inverters' last
//     reports, a few minutes behind) and `eim` (the CT, real time);
//   - `storage` in `production.json` describes the AC Battery (`acb`), absent here: the IQ
//     batteries of `/ivp/ensemble/` are what count, and they do not appear there;
//   - `livedata.connection.sc_stream` is "disabled" and yet the values are fresh.


export const INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<envoy_info><time>1789133700</time><device><sn>120340000000</sn><pn>800-00654-r09</pn>
<software>D8.3.5289</software><imeter>true</imeter></device><web-tokens>true</web-tokens></envoy_info>`

export const PRODUCTION = {
  "production": [
    {
      "type": "inverters",
      "activeCount": 20,
      "readingTime": 1789133698,
      "wNow": 4952,
      "whLifetime": 524922
    },
    {
      "type": "eim",
      "activeCount": 1,
      "measurementType": "production",
      "readingTime": 1789133705,
      "wNow": 6456.218,
      "whLifetime": 8272627.541,
      "varhLeadLifetime": 2908825.028,
      "varhLagLifetime": 3436381.259,
      "vahLifetime": 12389254.211,
      "rmsCurrent": 28.752,
      "rmsVoltage": 717.639,
      "reactPwr": -2351.02,
      "apprntPwr": 6879.965,
      "pwrFactor": 0.94,
      "whToday": 47126.541,
      "whLastSevenDays": 8243378.541,
      "vahToday": 37572.211,
      "varhLeadToday": 10327.028,
      "varhLagToday": 6193.259,
      "lines": [
        {
          "wNow": 2266.709,
          "whLifetime": 2892938.091,
          "varhLeadLifetime": 1020549.137,
          "varhLagLifetime": 1233467.039,
          "vahLifetime": 4363905.752,
          "rmsCurrent": 10.106,
          "rmsVoltage": 239.615,
          "reactPwr": -828.467,
          "apprntPwr": 2421.095,
          "pwrFactor": 0.94,
          "whToday": 20760.091,
          "whLastSevenDays": 2882791.091,
          "vahToday": 13102.752,
          "varhLeadToday": 3595.137,
          "varhLagToday": 2188.039
        },
        {
          "wNow": 1942.401,
          "whLifetime": 2484739.876,
          "varhLeadLifetime": 873714.261,
          "varhLagLifetime": 1024746.994,
          "vahLifetime": 3719482.747,
          "rmsCurrent": 8.738,
          "rmsVoltage": 236.719,
          "reactPwr": -708.137,
          "apprntPwr": 2068.039,
          "pwrFactor": 0.94,
          "whToday": 10072.876,
          "whLastSevenDays": 2475950.876,
          "vahToday": 11258.747,
          "varhLeadToday": 3098.261,
          "varhLagToday": 1846.994
        },
        {
          "wNow": 2247.108,
          "whLifetime": 2894949.574,
          "varhLeadLifetime": 1014561.631,
          "varhLagLifetime": 1178167.226,
          "vahLifetime": 4305865.713,
          "rmsCurrent": 9.908,
          "rmsVoltage": 241.305,
          "reactPwr": -814.416,
          "apprntPwr": 2390.832,
          "pwrFactor": 0.94,
          "whToday": 16293.574,
          "whLastSevenDays": 2884636.574,
          "vahToday": 13210.713,
          "varhLeadToday": 3633.631,
          "varhLagToday": 2158.226
        }
      ]
    }
  ],
  "consumption": [
    {
      "type": "eim",
      "activeCount": 1,
      "measurementType": "total-consumption",
      "readingTime": 1789133705,
      "wNow": 690.772,
      "whLifetime": 16302663.196,
      "varhLeadLifetime": 7628426.306,
      "varhLagLifetime": -2080757.702,
      "vahLifetime": 24594208.671,
      "rmsCurrent": 4.202,
      "rmsVoltage": 717.632,
      "reactPwr": -1516.981,
      "apprntPwr": 1005.191,
      "pwrFactor": 0.71,
      "whToday": 18516,
      "whLastSevenDays": 8035992,
      "vahToday": 44538.671,
      "varhLeadToday": 12646,
      "varhLagToday": 1146,
      "lines": [
        {
          "wNow": 251.38,
          "whLifetime": 5947963.575,
          "varhLeadLifetime": 2323175.329,
          "varhLagLifetime": -733285.257,
          "vahLifetime": 8126159.96,
          "rmsCurrent": 1.65,
          "rmsVoltage": 239.672,
          "reactPwr": -689.961,
          "apprntPwr": 395.39,
          "pwrFactor": 0.64,
          "whToday": 6560.575,
          "whLastSevenDays": 0.575,
          "vahToday": 13838.96,
          "varhLeadToday": 3392,
          "varhLagToday": 0
        },
        {
          "wNow": 278.252,
          "whLifetime": 5050888.707,
          "varhLeadLifetime": 2043770.027,
          "varhLagLifetime": -503524.491,
          "vahLifetime": 7678072.777,
          "rmsCurrent": 1.304,
          "rmsVoltage": 236.592,
          "reactPwr": -137.73,
          "apprntPwr": 308.404,
          "pwrFactor": 0.9,
          "whToday": 6402.707,
          "whLastSevenDays": 0.707,
          "vahToday": 14650.777,
          "varhLeadToday": 4350,
          "varhLagToday": 1146
        },
        {
          "wNow": 161.14,
          "whLifetime": 5303810.915,
          "varhLeadLifetime": 3261480.95,
          "varhLagLifetime": -843947.954,
          "vahLifetime": 8789975.934,
          "rmsCurrent": 1.249,
          "rmsVoltage": 241.368,
          "reactPwr": -689.289,
          "apprntPwr": 301.397,
          "pwrFactor": 0.53,
          "whToday": 5554.915,
          "whLastSevenDays": 0.915,
          "vahToday": 16048.934,
          "varhLeadToday": 4904,
          "varhLagToday": 0
        }
      ]
    },
    {
      "type": "eim",
      "activeCount": 1,
      "measurementType": "net-consumption",
      "readingTime": 1789133705,
      "wNow": -5765.446,
      "whLifetime": 8031063.409,
      "varhLeadLifetime": 10537251.334,
      "varhLagLifetime": 1355623.558,
      "vahLifetime": 24594208.671,
      "rmsCurrent": -24.55,
      "rmsVoltage": 717.632,
      "reactPwr": 834.039,
      "apprntPwr": -5875.78,
      "pwrFactor": -1,
      "whToday": 0,
      "whLastSevenDays": 0,
      "vahToday": 0,
      "varhLeadToday": 0,
      "varhLagToday": 0,
      "lines": [
        {
          "wNow": -2015.329,
          "whLifetime": 3055332.122,
          "varhLeadLifetime": 3343724.466,
          "varhLagLifetime": 500181.782,
          "vahLifetime": 8126159.96,
          "rmsCurrent": -8.457,
          "rmsVoltage": 239.672,
          "reactPwr": 138.505,
          "apprntPwr": -2026.8,
          "pwrFactor": -1,
          "whToday": 0,
          "whLastSevenDays": 0,
          "vahToday": 0,
          "varhLeadToday": 0,
          "varhLagToday": 0
        },
        {
          "wNow": -1664.149,
          "whLifetime": 2566419.769,
          "varhLeadLifetime": 2917484.288,
          "varhLagLifetime": 521222.504,
          "vahLifetime": 7678072.777,
          "rmsCurrent": -7.434,
          "rmsVoltage": 236.592,
          "reactPwr": 570.407,
          "apprntPwr": -1758.929,
          "pwrFactor": -1,
          "whToday": 0,
          "whLastSevenDays": 0,
          "vahToday": 0,
          "varhLeadToday": 0,
          "varhLagToday": 0
        },
        {
          "wNow": -2085.968,
          "whLifetime": 2409311.518,
          "varhLeadLifetime": 4276042.581,
          "varhLagLifetime": 334219.272,
          "vahLifetime": 8789975.934,
          "rmsCurrent": -8.659,
          "rmsVoltage": 241.368,
          "reactPwr": 125.127,
          "apprntPwr": -2090.052,
          "pwrFactor": -1,
          "whToday": 0,
          "whLastSevenDays": 0,
          "vahToday": 0,
          "varhLeadToday": 0,
          "varhLagToday": 0
        }
      ]
    }
  ],
  "storage": [
    {
      "type": "acb",
      "activeCount": 0,
      "readingTime": 0,
      "wNow": 0,
      "whNow": 0,
      "state": "idle"
    }
  ]
} as const

export const INVERTERS = [
  {
    "serialNumber": "120340000137",
    "lastReportDate": 1789133693,
    "devType": 1,
    "lastReportWatts": 326,
    "maxReportWatts": 422
  },
  {
    "serialNumber": "120340000274",
    "lastReportDate": 1789133452,
    "devType": 1,
    "lastReportWatts": 221,
    "maxReportWatts": 419
  },
  {
    "serialNumber": "120340000411",
    "lastReportDate": 1789133422,
    "devType": 1,
    "lastReportWatts": 217,
    "maxReportWatts": 420
  },
  {
    "serialNumber": "120340000548",
    "lastReportDate": 1789133423,
    "devType": 1,
    "lastReportWatts": 209,
    "maxReportWatts": 423
  },
  {
    "serialNumber": "120340000685",
    "lastReportDate": 1789133482,
    "devType": 1,
    "lastReportWatts": 245,
    "maxReportWatts": 419
  },
  {
    "serialNumber": "120340000822",
    "lastReportDate": 1789133513,
    "devType": 1,
    "lastReportWatts": 271,
    "maxReportWatts": 421
  },
  {
    "serialNumber": "120340000959",
    "lastReportDate": 1789133424,
    "devType": 1,
    "lastReportWatts": 214,
    "maxReportWatts": 418
  },
  {
    "serialNumber": "120340001096",
    "lastReportDate": 1789133425,
    "devType": 1,
    "lastReportWatts": 218,
    "maxReportWatts": 423
  },
  {
    "serialNumber": "120340001233",
    "lastReportDate": 1789133515,
    "devType": 1,
    "lastReportWatts": 273,
    "maxReportWatts": 423
  },
  {
    "serialNumber": "120340001370",
    "lastReportDate": 1789133516,
    "devType": 1,
    "lastReportWatts": 272,
    "maxReportWatts": 421
  },
  {
    "serialNumber": "120340001507",
    "lastReportDate": 1789133517,
    "devType": 1,
    "lastReportWatts": 274,
    "maxReportWatts": 422
  },
  {
    "serialNumber": "120340001644",
    "lastReportDate": 1789133426,
    "devType": 1,
    "lastReportWatts": 207,
    "maxReportWatts": 437
  },
  {
    "serialNumber": "120340001781",
    "lastReportDate": 1789133428,
    "devType": 1,
    "lastReportWatts": 213,
    "maxReportWatts": 430
  },
  {
    "serialNumber": "120340001918",
    "lastReportDate": 1789133455,
    "devType": 1,
    "lastReportWatts": 216,
    "maxReportWatts": 438
  },
  {
    "serialNumber": "120340002055",
    "lastReportDate": 1789133457,
    "devType": 1,
    "lastReportWatts": 216,
    "maxReportWatts": 437
  },
  {
    "serialNumber": "120340002192",
    "lastReportDate": 1789133694,
    "devType": 1,
    "lastReportWatts": 326,
    "maxReportWatts": 430
  },
  {
    "serialNumber": "120340002329",
    "lastReportDate": 1789133458,
    "devType": 1,
    "lastReportWatts": 217,
    "maxReportWatts": 438
  },
  {
    "serialNumber": "120340002466",
    "lastReportDate": 1789133459,
    "devType": 1,
    "lastReportWatts": 218,
    "maxReportWatts": 440
  },
  {
    "serialNumber": "120340002603",
    "lastReportDate": 1789133518,
    "devType": 1,
    "lastReportWatts": 274,
    "maxReportWatts": 438
  },
  {
    "serialNumber": "120340002740",
    "lastReportDate": 1789133695,
    "devType": 1,
    "lastReportWatts": 326,
    "maxReportWatts": 438
  }
] as const

export const METERS = [
  {
    "eid": 704643328,
    "state": "enabled",
    "measurementType": "production",
    "phaseMode": "three",
    "phaseCount": 3,
    "meteringStatus": "normal",
    "statusFlags": []
  },
  {
    "eid": 704643584,
    "state": "enabled",
    "measurementType": "net-consumption",
    "phaseMode": "three",
    "phaseCount": 3,
    "meteringStatus": "normal",
    "statusFlags": []
  }
] as const

export const LIVEDATA = {
  "info": "Last available status data shown. Live stream not enabled. Enable using /ivp/livedata/stream/ API",
  "connection": {
    "mqtt_state": "connected",
    "prov_state": "configured",
    "auth_state": "ok",
    "sc_stream": "disabled",
    "sc_debug": "disabled"
  },
  "meters": {
    "last_update": 1789133706,
    "soc": 100,
    "main_relay_state": 1,
    "gen_relay_state": 5,
    "backup_bat_mode": 1,
    "backup_soc": 0,
    "is_split_phase": 0,
    "phase_count": 3,
    "enc_agg_soc": 100,
    "enc_agg_energy": 10000,
    "acb_agg_soc": 0,
    "acb_agg_energy": 0,
    "pv": {
      "agg_p_mw": 6471726,
      "agg_s_mva": 6882719,
      "agg_p_ph_a_mw": 2268472,
      "agg_p_ph_b_mw": 1948131,
      "agg_p_ph_c_mw": 2255123,
      "agg_s_ph_a_mva": 2421895,
      "agg_s_ph_b_mva": 2068860,
      "agg_s_ph_c_mva": 2391963
    },
    "storage": {
      "agg_p_mw": 16000,
      "agg_s_mva": 16000,
      "agg_p_ph_a_mw": 0,
      "agg_p_ph_b_mw": -8000,
      "agg_p_ph_c_mw": 0,
      "agg_s_ph_a_mva": -7245,
      "agg_s_ph_b_mva": -1726,
      "agg_s_ph_c_mva": 6104
    },
    "grid": {
      "agg_p_mw": -5762777,
      "agg_s_mva": -5877899,
      "agg_p_ph_a_mw": -2017439,
      "agg_p_ph_b_mw": -1661244,
      "agg_p_ph_c_mw": -2084095,
      "agg_s_ph_a_mva": -2028403,
      "agg_s_ph_b_mva": -1759932,
      "agg_s_ph_c_mva": -2089565
    },
    "load": {
      "agg_p_mw": 724949,
      "agg_s_mva": 1020820,
      "agg_p_ph_a_mw": 251033,
      "agg_p_ph_b_mw": 278887,
      "agg_p_ph_c_mw": 171028,
      "agg_s_ph_a_mva": 386247,
      "agg_s_ph_b_mva": 307202,
      "agg_s_ph_c_mva": 308502
    },
    "generator": {
      "agg_p_mw": 0,
      "agg_s_mva": 0,
      "agg_p_ph_a_mw": 0,
      "agg_p_ph_b_mw": 0,
      "agg_p_ph_c_mw": 0,
      "agg_s_ph_a_mva": 0,
      "agg_s_ph_b_mva": 0,
      "agg_s_ph_c_mva": 0
    }
  },
  "tasks": {
    "task_id": 1905396943,
    "timestamp": 1789115949
  },
  "counters": {
    "main_CfgLoad": 3,
    "main_CfgChanged": 2,
    "main_taskUpdate": 29,
    "MqttClient_publish": 11700,
    "MqttClient_respond": 84,
    "MqttClient_msgarrvd": 42,
    "MqttClient_reconnect": 2,
    "MqttClient_create": 12,
    "MqttClient_setCallbacks": 12,
    "MqttClient_connect": 12,
    "MqttClient_connect_err": 7,
    "MqttClient_connect_Err": 7,
    "MqttClient_subscribe": 5,
    "SSL_Keys_Create": 12,
    "sc_SendStreamCtrl": 26,
    "rest_Status": 9657
  },
  "dry_contacts": {
    "": {
      "dry_contact_id": "",
      "dry_contact_type": "",
      "dry_contact_load_name": "",
      "dry_contact_status": 0
    }
  }
} as const

export const ENSEMBLE_INVENTORY = [
  {
    "type": "ENCHARGE",
    "devices": [
      {
        "part_num": "836-00500-r21",
        "serial_num": "120340002877",
        "installed": 1788261054,
        "device_status": [
          "envoy.global.ok",
          "prop.done"
        ],
        "last_rpt_date": 1789133686,
        "admin_state": 6,
        "admin_state_str": "ENCHG_STATE_READY",
        "created_date": 1788261054,
        "img_load_date": 1788261054,
        "img_pnum_running": "3.0.8817_rel/31.45",
        "bmu_fw_version": "3.8.78",
        "communicating": true,
        "sleep_enabled": false,
        "percentFull": 100,
        "temperature": 29,
        "maxCellTemp": 30,
        "reported_enc_grid_state": "grid-tied",
        "comm_level_sub_ghz": 0,
        "comm_level_2_4_ghz": 0,
        "led_status": 14,
        "dc_switch_off": false,
        "encharge_rev": 3,
        "encharge_capacity": 5000,
        "phase": "ph-all",
        "der_index": 1
      },
      {
        "part_num": "836-00500-r22",
        "serial_num": "120340003014",
        "installed": 1788261053,
        "device_status": [
          "envoy.global.ok",
          "prop.done"
        ],
        "last_rpt_date": 1789133682,
        "admin_state": 6,
        "admin_state_str": "ENCHG_STATE_READY",
        "created_date": 1788261053,
        "img_load_date": 1788261053,
        "img_pnum_running": "3.0.8817_rel/31.45",
        "bmu_fw_version": "3.8.78",
        "communicating": true,
        "sleep_enabled": false,
        "percentFull": 100,
        "temperature": 29,
        "maxCellTemp": 30,
        "reported_enc_grid_state": "grid-tied",
        "comm_level_sub_ghz": 0,
        "comm_level_2_4_ghz": 0,
        "led_status": 14,
        "dc_switch_off": false,
        "encharge_rev": 3,
        "encharge_capacity": 5000,
        "phase": "ph-all",
        "der_index": 1
      }
    ]
  }
] as const

export const ENSEMBLE_POWER = {
  "devices:": [
    {
      "serial_num": "120340002877",
      "real_power_mw": 0,
      "apparent_power_mva": 0,
      "soc": 100
    },
    {
      "serial_num": "120340003014",
      "real_power_mw": 16000,
      "apparent_power_mva": 16000,
      "soc": 100
    }
  ]
} as const
