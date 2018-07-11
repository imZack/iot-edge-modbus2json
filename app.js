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
  switch(tag.typeName) {
    case 'uint':
      if (buff.length == 1) return buff.readUInt16LE(0);
      else if (buff.length == 2) return buff.readUInt32LE(0);
      else return;
    case 'int':
      if (buff.length == 1) return buff.readInt16LE(0);
      else if (buff.length == 2) return buff.readInt32LE(0);
      else return;
    case 'float':
      if (buff.length == 1) {
        debug('type: float with buff size 1');
        return;
      }
      else if (buff.length == 2) return buff.readInt32LE(0);
      else return;
    default:
      debug(`Non type matched ${typeName}`);
      return;
  }
}
  
const scaleValue = function scalingValue(tag, value) {
  if (tag.scaling == 'point-slope') {
    // *Result = n2 + (input - n1) x [(m2-n2)/(m1-n1)]
    return tag.pointParams.min2 + (tag - tag.pointParams.min1) * ((tag.pointParams.max2 - tag.pointParams.min2) / (tag.pointParams.max1 - tag.pointParams.min1));
  } else if (tag.scaling == 'slope-intercept') {
    return tag * tag.interceptParams.slope + tag.slopeParams.offset;
  } else if (tag.scaling == 'none') {
    return tag;
  }

  debug(`Non of scaling type matched ${tag.scaling}`);
  return tag;
}

console.error = (message) => {
  throw new Error(message);
};

let tags = [];
const processTag = function processTag(data, tag) {
  const { addressArr } = tag;

  if (addressArr.length === 0 || addressArr.length > 2) {
    debug('processTag addressArr lenght === 0 || addressArr.length > 2');
    return false;
  }

  const arrLength = addressArr.length;
  for (let i = 0; i < arrLength; i += 1) {
    if (data[addressArr[i]] === undefined) {
      debug('data[%d] === undefined', i);
      return false;
    }
  }

  let buff;
  if (arrLength === 1) {
    buff = Buffer.alloc(4, 0);
    buff.writeUInt16LE(+data[addressArr[0]].Value, 0);
  } else {
    buff = byteMerge(
      +data[addressArr[0]].Value,
      +data[addressArr[1]].Value,
    );
  }

  debug(`buff: ${buff}`);
  const value = convertToDataType(tag, buff);
  if (value === undefined) return;

  const scaledValue = scaleValue(tag, value);

  debug('tag: %s, value: %f, scaledValue: %f', tag.name, value, scaledValue);
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

  client.open(openErr => {
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

      tags = twin.properties.desired.tags || tags;
      debug('tags', tags);
      twin.on('properties.desired', (delta) => {
        try {
          tags = JSON.parse(delta.tags);
          debug('update tags', tags);
        } catch (error) {
          debug('update tags failed', tags);
          console.error(err);
        }
      });
    });

    client.on('inputMessage', (inputName, rawMsg) => {
      if (inputName !== 'modbus') {
        debug('Unknown inputMessage received on input', inputName);
        return;
      }

      let msg = JSON.parse(rawMsg.getBytes().toString());
      const messages = {};
      if (!Array.isArray(msg)) {
        msg = [msg];
      }

      msg.forEach((row) => {
        if (!messages[row.SourceTimestamp]) messages[row.SourceTimestamp] = {};
        row.Values.forEach(entry => {
          messages[row.SourceTimestamp][entry.Address] = entry;
        });
      });

      const tagObjs = [].concat(...Object
        .keys(messages)
        .map(key => messages[key])
        .map(val => tags
          .map(tag => processTag(val, tag))
          .filter(parsedTag => parsedTag !== false)));

      if (tagObjs.length == 0) {
        debug("Nothing to send, return");
        return;
      }

      client
        .sendOutputEvent('tags', new Message(JSON.stringify(tagObjs)), () => {});
    });
  });
});

