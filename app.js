const Protocol = require('azure-iot-device-mqtt').Mqtt;
const Client = require('azure-iot-device').ModuleClient;
const { Message } = require('azure-iot-device');
const fs = require('fs');
const debug = require('debug')('iot-edge-modbus2json:app');

const byteMerge = function byteMerge(low, high) {
  const output = Buffer.alloc(4, 0);
  output.writeUInt16LE(low, 2);
  output.writeUInt16LE(high, 0);
  return output;
};

const convertToDataType = function convertToDataType(tag, buff) {
  switch (tag.dataType) {
    case 'uint':
      if (buff.length === 2) return buff.readUInt16LE(0);
      if (buff.length === 4) return buff.readUInt32LE(0);
      return false;
    case 'int':
      if (buff.length === 2) return buff.readInt16LE(0);
      if (buff.length === 4) return buff.readInt32LE(0);
      return false;
    case 'float':
      if (buff.length === 2) {
        debug('type: float with buff size 2');
        return false;
      }
      if (buff.length === 4) return buff.readFloatLE(0);
      return false;
    default:
      debug(`Non type matched ${tag.dataType}`);
      return false;
  }
};

const scaleValue = function scaleValue(tag, value) {
  if (tag.scaling === 'point-slope') {
    // *Result = n2 + (input - n1) x [(m2-n2)/(m1-n1)]
    return tag.pointParams.min2 + (
      (value - tag.pointParams.min1) * (
        (tag.pointParams.max2 - tag.pointParams.min2)
        / (tag.pointParams.max1 - tag.pointParams.min1)
      )
    );
  }

  if (tag.scaling === 'slope-intercept') {
    return (value * tag.interceptParams.slope) + tag.interceptParams.offset;
  }

  if (tag.scaling === 'none') {
    return value;
  }

  debug(`Non of scaling type matched ${tag.scaling}`);
  return tag;
};

console.error = (message) => {
  throw new Error(message);
};

let tags = [];
const processTag = function processTag(data, tag) {
  const { addressArr } = tag;
  const arrLength = addressArr.length;

  if (arrLength === 0 || addressArr.length > 2) {
    debug('processTag addressArr lenght === 0 || arrLength > 2');
    return false;
  }

  for (let i = 0; i < arrLength; i += 1) {
    if (data[addressArr[i]] === undefined) {
      debug(`data[${i}] === undefined`);
      return false;
    }
  }

  let buff;
  if (arrLength === 1) {
    buff = Buffer.alloc(2, 0);
    buff.writeUInt16LE(+data[addressArr[0]].Value, 0);
  } else {
    buff = byteMerge(
      +data[addressArr[0]].Value,
      +data[addressArr[1]].Value,
    );
  }

  debug('buff', buff);
  const value = convertToDataType(tag, buff);
  debug('value', value);
  if (value === undefined) return false;

  const scaledValue = scaleValue(tag, value);

  debug(`tag: ${tag.name}, value: ${value}, scaledValue: ${scaledValue}`);
  return {
    DisplayName: tag.name,
    Value: scaledValue,
    HwId: data[addressArr[0]].HwId,
    SourceTimestamp: new Date(`${data[addressArr[0]].SourceTimestamp}Z`)
      .toISOString(),
  };
};

Client.fromEnvironment(Protocol, (err, client) => {
  if (err) {
    console.error(err);
    return;
  }

  client.on('error', (onErr) => {
    console.error(onErr.message);
  });

  client.open((openErr) => {
    if (openErr) {
      console.error(err);
      return;
    }

    debug('Client connected');

    client.getTwin((errTwin, twin) => {
      if (errTwin) {
        console.error(err);
        return;
      }

      if (!twin) {
        console.error(err);
        return;
      }

      // tags = twin.properties.desired.tags || tags;
      // debug('tags', tags);
      twin.on('properties.desired', (delta) => {
        tags = [];
        for (var key in delta.tags) {
          const tag = delta.tags[key];
          if (!tag) continue;
          tag.addressArr = tag.addressArr.split(',');
          tags.push(tag);
        }
        debug('tags updated', tags);
      });
    });

    client.on('inputMessage', (inputName, rawMsg) => {
      if (inputName !== 'modbus') {
        debug('Unknown inputMessage received on input', inputName);
        return;
      }

      let msg = JSON.parse(rawMsg.getBytes().toString());
      if (!Array.isArray(msg)) {
        msg = [msg];
      }

      /*
      [
        {
          "PublishTimestamp": "2018-04-17 12:28:53",
          "Content": [
            {
              "HwId": "PowerMeter-0a:01:01:01:01:02",
              "Data": [
                {
                  "CorrelationId": "MessageType1",
                  "SourceTimestamp": "2018-04-17 12:28:50",
                  "Values": [
                    {
                      "DisplayName": "Op02",
                      "Address": "40003",
                      "Value": "21578"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
      */

      let tagList = [];
      msg.forEach((record) => {
        if (!record.Content) return;
        record.Content.forEach((content) => {
          content.Data.forEach((pollData) => {
            const tagStore = {};
            pollData.Values.forEach((tag) => {
              tagStore[tag.Address] = {
                HwId: content.HwId,
                Value: tag.Value,
                SourceTimestamp: pollData.SourceTimestamp,
              };
            });

            debug(`tagStore: ${JSON.stringify(tagStore)}`);
            tagList = tagList
              .concat(tags
                .map(tag => processTag(tagStore, tag))
                .filter(parsedTag => parsedTag !== false));
          });
        });
      });

      if (tagList.length === 0) {
        debug('Nothing to send, return');
        return;
      }

      client
        .sendOutputEvent(
          'tags',
          new Message(JSON.stringify(tagList)),
          () => {},
        );
    });
  });
});
