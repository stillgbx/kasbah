// Responses CAPTURED from the Enlighten cloud of a real account (IQ EV Charger 2 EU 32 A).
// Written from GET /api/plugins/enphase/ev/raw, not from the documentation: same lesson as the
// gateway (storage sign) and TaHoma. Serial numbers, site, SSID, MAC and LAN addresses replaced
// by stable values. `error: {}` is part of the vendor's 200 response, it is not a failure.

export const EVSE_STATUS = {
  "meta": {
    "serverTimeStamp": 1789892800264
  },
  "data": {
    "site": "1000001",
    "tz": "Europe/Paris",
    "chargers": [
      {
        "smartEV": {
          "hasToken": false,
          "hasEVDetails": false
        },
        "evManufacturerName": "Renault",
        "offGrid": "ON_GRID",
        "sn": "482000000001",
        "name": "Borne Enphase",
        "lst_rpt_at": "2026-09-20T08:26:05Z[UTC]",
        "offlineAt": "2026-09-09T09:40:45.397Z[UTC]",
        "connected": true,
        "auth_token": null,
        "mode": 1,
        "charging": false,
        "pluggedIn": true,
        "faulted": false,
        "commissioned": 1,
        "isEVDetailsSet": true,
        "sch_d": {
          "status": 1,
          "info": [
            {
              "type": "greencharging",
              "startTime": 1789892700,
              "endTime": 1789893120,
              "limit": 0
            },
            {
              "type": "greencharging",
              "startTime": 1789893120,
              "endTime": 1789979100,
              "limit": 0
            }
          ]
        },
        "session_d": {
          "plg_in_at": "2026-09-17T10:37:48.265Z[UTC]",
          "strt_chrg": 1789822224096,
          "plg_out_at": null,
          "e_c": 12363,
          "e_d": 0,
          "soc": 0,
          "miles": 44.36558,
          "session_cost": null,
          "auth_status": 4,
          "auth_type": null,
          "auth_id": null,
          "charge_level": null,
          "is_bidi": false
        },
        "connectors": [
          {
            "connectorId": 1,
            "connectorStatusType": "SUSPENDED_EVSE",
            "powerFlowDirection": "Import",
            "connectorStatusInfo": "SwitchingPhases",
            "connectorStatusReason": "INSUFFICIENT_SOLAR",
            "safeLimitState": 0,
            "isDoublePumpSession": false,
            "pluggedIn": true,
            "dlbActive": false
          }
        ]
      }
    ]
  },
  "error": {}
} as const

export const EVSE_STATUS_V2 = {
  "meta": {
    "serverTimeStamp": 1789892800716
  },
  "data": {
    "482000000001": {
      "connected": true,
      "pluggedIn": true,
      "charging": false,
      "lst_rpt_at": 1789892765000,
      "flow_direction": null,
      "discharge_mode": null
    }
  },
  "error": {}
} as const

export const EVSE_SUMMARY = {
  "meta": {
    "serverTimeStamp": 1789892800847,
    "rowCount": 1
  },
  "data": [
    {
      "lastReportedAt": "2026-09-20T08:26:05Z[UTC]",
      "supportsUseBattery": true,
      "warrantyDueDate": "2030-06-01T09:00:00.000000000Z[UTC]",
      "hoControl": true,
      "processorBoardVersion": "2.0.907.0",
      "activeConnection": "wifi",
      "defaultRoute": "interface=mlan0, ip_address=192.168.1.1",
      "dlbEnabled": 1,
      "ski": null,
      "createdAt": "2025-06-01T09:00:00.000000000Z[UTC]",
      "warrantyStartDate": "2025-06-01T09:00:00.000000000Z[UTC]",
      "bootloaderVersion": "2024.04",
      "sku": "IQ-EVSE-EU-3032-0105-1300",
      "firmwareVersion": "26.19.1.9",
      "cellularConfig": "signalStrength=0, status=disconnected, network=, info=",
      "applicationVersion": "26.20.1.5",
      "serialNumber": "482000000001",
      "commissioningStatus": 1,
      "phaseMode": 3,
      "ratedCurrent": "32",
      "kernelVersion": "6.6.23-lts-next-g6fc938c059f4",
      "bidiSupported": false,
      "status": "NORMAL",
      "phaseCount": 3,
      "chargeLevelDetails": {
        "min": "6",
        "max": "32",
        "granularity": "1",
        "defaultChargeLevel": "24.0"
      },
      "displayName": "Borne Enphase",
      "timezone": "Europe/Paris",
      "isConnected": true,
      "wifiConfig": "connectionStatus=1, wifiMode=client, SSID=Maison, status=connected",
      "operatingVoltage": "230",
      "wiringConfiguration": {
        "L1": "L1",
        "L2": "L2",
        "L3": "L3",
        "N": "N"
      },
      "systemVersion": "26.19.1.9",
      "maxCurrent": 32,
      "warrantyPeriod": 5,
      "gridType": 4,
      "lifeTimeConsumption": 3500000.00,
      "hoControlScope": [],
      "reportingInterval": 300,
      "gatewayConnectivityDetails": [
        {
          "gwSerialNum": "120340000000",
          "gwConnStatus": 0,
          "gwConnFailureReason": 0,
          "lastConnTime": 1789516062293
        }
      ],
      "rmaDetails": null,
      "networkConfig": "[\n\"netmask=,mac_addr=,interface_name=eth0,connectionStatus=0,ipaddr=,bootproto=dhcp,gateway=\",\n\"netmask=255.255.255.0,mac_addr=00:11:22:33:44:55,interface_name=mlan0,connectionStatus=1,ipaddr=192.168.1.50,bootproto=dhcp,gateway=192.168.1.1\"\n]",
      "breakerRating": 32,
      "modelName": "IQ-EVSE-EU-3032",
      "isLocallyConnected": true,
      "siteId": 1000001,
      "powerBoardVersion": "25.28.21.0",
      "partNumber": "865-02030 09",
      "isRetired": false,
      "functionalValDetails": {
        "lastUpdatedTimestamp": 1764670434780,
        "state": 1
      },
      "skuScope": "GEN2_EU"
    }
  ],
  "error": {}
} as const

/**
 * `GET /service/evse_scheduler/api/v1/iqevc/charging-mode/{site}/{sn}/preference`, captured on
 * 2026-10-02 from the unplugged charger that still held its cancellation (`mode: 0` in the state).
 */
export const EVSE_PREFERENCE = {
  "meta": { "serverTimeStamp": "2026-10-02T10:00:49.981+00:00" },
  "data": {
    "config": {
      "profile": "self-consumption", "modeSyncStatus": "synced", "stormActive": false, "isModeCancellable": true,
      "pendingModesOffGrid": false, "pendingSchedulesOffGrid": false, "isExternalMeterEnabled": false
    },
    "modes": {
      "greenCharging": { "chargingMode": "GREEN_CHARGING", "enabled": true, "showSettings": false, "isHidden": false, "isDisabledByStorm": false, "schedulesEnabled": 0 },
      "scheduledCharging": { "chargingMode": "SCHEDULED_CHARGING", "enabled": false, "showSettings": false, "isHidden": false, "isDisabledByStorm": false, "schedulesEnabled": 0 },
      "manualCharging": { "chargingMode": "MANUAL_CHARGING", "enabled": false, "showSettings": false, "isHidden": false, "isDisabledByStorm": false }
    }
  },
  "error": {}
}
