# Azure IoT Edge Module: modbus2json

Convert [Azure/iot-edge-modbus](https://github.com/Azure/iot-edge-modbus)'s output to JSON (and more Power BI friendly format).

## Module Twin Format

```json
[
  {
    "name": "TAG NAME",
    "addressArr": [ADDRESS_1, ADDRESS_2]
  }
]
```

## Get Started

Add Modbus Module: [iot-edge-modbus](https://github.com/Azure/iot-edge-modbus)

### Modbus Setting

```json
{
  "PublishInterval": "5000",
  "SlaveConfigs": {
    "Slave01": {
      "SlaveConnection": "192.168.116.111",
      "HwId": "PowerMeter-0a:01:01:01:01:01",
      "RetryCount": "10",
      "RetryInterval": "50",
      "Operations": {
        "Op01": {
          "PollingInterval": "5000",
          "UnitId": "10",
          "StartAddress": "40289",
          "Count": "2",
          "DisplayName": "AvgCurrent (Amp)",
          "CorrelationId": "MessageType1"
        },
        "Op02": {
          "PollingInterval": "5000",
          "UnitId": "10",
          "StartAddress": "40287",
          "Count": "2",
          "DisplayName": "AvgVoltage L-N (Volt)",
          "CorrelationId": "MessageType1"
        },
        "Op04": {
          "PollingInterval": "5000",
          "UnitId": "10",
          "StartAddress": "40257",
          "Count": "2",
          "DisplayName": "RealEnergyNet (kWh)",
          "CorrelationId": "MessageType1"
        },
        "Op05": {
          "PollingInterval": "5000",
          "UnitId": "10",
          "StartAddress": "40259",
          "Count": "2",
          "DisplayName": "RealEnergyImport (kWh)",
          "CorrelationId": "MessageType1"
        },
        "Op06": {
          "PollingInterval": "5000",
          "UnitId": "10",
          "StartAddress": "40261",
          "Count": "2",
          "DisplayName": "RealEnergyExport (kWh)",
          "CorrelationId": "MessageType1"
        }
      }
    }
  }
}
```

Once above configuration has been set, the modbus module will start to poll all the tags from modbus slave. You could always check the output of an IoT Edge Module via command `docker logs -f --tail=50 modbus`

```shell
root@Moxa:/home/moxa/edge-sample# docker logs -f --tail=50 modbus
40260: 38521

40287: 17291

40288: 9501

40289: 17155

40290: 38752

40257: 18972

40258: 49743

40261: 18004

40262: 10651

40259: 18973

40260: 38521

40287: 17291

40288: 6165
```

**Problem**: These are the raw values of each Modbus address which means we have to translate/merge/scaling to a real tags. And that's why I wrote this tiny module.

### Add a new IoT Edge module

- **Name**: `modbus2json`
- **Image URI**: `zack/iot-edge-modbus2json:linux-arm-latest`

- Enable Module Twin

  ```json
  {
    "properties.desired": {
      "tags": "[{\"name\":\"AvgVoltage (volt)\",\"addressArr\":[40287,40288]},{\"name\":\"AvgCurrent (amp)\",\"addressArr\":[40289,40290]},{\"name\":\"RealEnergyNet (kWatt)\",\"addressArr\":[40257,40258]},{\"name\":\"RealEnergyImport (kWh)\",\"addressArr\":[40259,40260]},{\"name\":\"RealEnergyExport (kWh)\",\"addressArr\":[40261,40262]}]"
    }
  }
  ```

### Setup routing as following example

```json
{
  "routes": {
    "modbusToConverter": "FROM /messages/modules/modbus/outputs/modbusOutput INTO BrokeredEndpoint(\"/modules/modbus2json/inputs/modbus\")",
    "ConverterToIoTHub": "FROM /messages/modules/modbus2json/outputs/* INTO $upstream"
  }
}
```

Now all the data would been published to IoT Hub and you could setup a Stream Analytics job for feeding to Power BI dataset.
