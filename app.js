const Protocol = require('azure-iot-device-mqtt').Mqtt;
const Client = require('azure-iot-device').ModuleClient;
const { Message } = require('azure-iot-device');
const fs = require('fs');
const debug = require('debug')('iot-edge-modbus2json:app');

const connectionString = process.env.EdgeHubConnectionString;
const moduleCACertFile = process.env.EdgeModuleCACertificateFile;

const byteMerge = function byteMerge(low, high) {
  const output = Buffer.alloc(4, 0);
  output.writeUInt16LE(low, 2);
  output.writeUInt16LE(high, 0);
  return output;
};

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

  let value;
  if (arrLength === 1) {
    [value] = addressArr;
  } else {
    value = byteMerge(
      +data[addressArr[0]].Value,
      +data[addressArr[1]].Value,
    ).readFloatLE(0);
  }

  debug('tag: %s, value: %f', tag.name, value);
  return {
    DisplayName: tag.name,
    Value: value,
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

  client.on('error', (err) => {
    console.error(err.message);
  });

/*
  client.setOptions({ ca: fs.readFileSync(moduleCACertFile).toString() }, (err) => {
  if (err) {
      console.error('Client setOptions error', err);
      return;
  }
*/
  client.open(err => {

      debug('Client connected');
      client.getTwin((errTwin, twin) => {
      tags = twin.properties.desired.tags || tags;
      debug('tags', tags);
      twin.on('properties.desired', (delta) => {
          try {
          tags = JSON.parse(delta.tags);
          debug('update tags', tags);
          } catch (error) {
          debug('update tags failed', tags);
          debug(error);
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
          messages[row.SourceTimestamp][row.Address] = row;
      });

      const tagObjs = [].concat(...Object
          .keys(messages)
          .map(key => messages[key])
          .map(val => tags
          .map(tag => processTag(val, tag))
          .filter(parsedTag => parsedTag !== undefined)));

      client
          .sendOutputEvent('tags', new Message(JSON.stringify(tagObjs)), () => {});
      });
  });
});

