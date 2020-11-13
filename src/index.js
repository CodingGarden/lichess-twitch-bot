/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
const axios = require('axios');
const tmi = require('tmi.js');
const { EventEmitter } = require('events');

require('dotenv').config();

const {
  BOT_TOKEN,
  BOT_NAME,
  TWITCH_CHANNEL,
} = process.env;

const BASE_URL = 'https://lichess.org';
const headers = {
  Authorization: `Bearer ${BOT_TOKEN}`,
};

const twitchClient = tmi.client({
  connection: {
    secure: true,
    reconnect: true,
  },
  channels: [TWITCH_CHANNEL],
});

twitchClient.connect();

async function updateChallenge(event, answer = 'accept') {
  await axios({
    method: 'POST',
    url: `${BASE_URL}/api/challenge/${event.challenge.id}/${answer}`,
    headers,
  });
}

async function makeMove(gameId, move) {
  try {
    const { data } = await axios({
      method: 'POST',
      url: `${BASE_URL}/api/bot/game/${gameId}/move/${move}`,
      headers,
    });
    return data;
  } catch (error) {
    return {
      ok: false,
    };
  }
}

function streamUrl(url) {
  const emitter = new EventEmitter();
  (async () => {
    const source = axios.CancelToken.source();
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      headers,
      cancelToken: source.token,
    });
    let canceled = false;
    emitter.stop = () => {
      canceled = true;
      source.cancel('Stop listening!');
    };
    try {
      for await (const chunk of response.data) {
        if (canceled) {
          console.log('STOPPING LISTENER FOR', url);
          break;
        }
        // TODO: this will probably break if a JSON object is split across multiple chunks....
        const jsonString = new TextDecoder('utf-8').decode(chunk, { stream: true });
        if (jsonString.trim()) {
          const parts = jsonString.split('\n');
          parts.forEach((part) => {
            if (part.trim()) {
              const event = JSON.parse(part);
              emitter.emit('event', event);
            }
          });
        }
      }
    } catch (error) {
      console.log('Stream was canceled. Probably.');
    }
  })();
  return emitter;
}

async function startGame(event) {
  const gameId = event.game.id;
  const game = streamUrl(`${BASE_URL}/api/bot/game/stream/${gameId}`);
  let moveChoices = new Map();
  let players = new Set();
  let chatTurn = false;
  twitchClient.on('message', (channel, tags, message) => {
    if (!chatTurn) return;
    const userId = tags['user-id'];
    message = message.toLowerCase();
    const matches = message.match(/^!move ([a-h][1-8][a-h][1-8][qbnr]?)$/);
    if (matches && !players.has(userId)) {
      const move = matches[1];
      players.add(userId);
      if (!moveChoices.has(move)) {
        moveChoices.set(move, 0);
      }
      moveChoices.set(move, moveChoices.get(move) + 1);
      console.log(moveChoices);
    }
  });
  let fullGameState;
  game.on('event', async (gameEvent) => {
    console.log(gameEvent);
    if (gameEvent.type === 'gameFull') {
      fullGameState = gameEvent;
    }
    if (gameEvent.winner) {
      twitchClient.removeAllListeners('message');
      game.stop();
      return;
    }
    const gameState = gameEvent.type === 'gameFull' ? gameEvent.state : gameEvent;
    const allMoves = gameState.moves.split(' ').filter((m) => m);
    const turn = allMoves.length % 2;
    console.log({ turn, allMoves });
    if (
      (turn === 0 && fullGameState.white.id === BOT_NAME)
        || (turn === 1 && fullGameState.black.id === BOT_NAME)
    ) {
      console.log('CHAT\'s TURN!');
      chatTurn = true;
      const listenMoves = (ms = 60 * 1000) => setTimeout(async () => {
        const moves = [...moveChoices.entries()]
          .sort(([, countA], [, countB]) => countB - countA);
        const move = moves.shift();
        console.log('Making move:', move);
        const result = await makeMove(gameId, move[0]);
        if (!result.ok) {
          console.log('BAD MOVE! STILL BOTS TURN TO MOVE!');
          listenMoves(ms / 2);
        } else {
          chatTurn = false;
          console.log('MOVE WAS MADE!');
        }
        moveChoices = new Map();
        players = new Set();
      }, ms);
      listenMoves();
    } else {
      console.log('CJ\'s TURN!');
    }
  });
}

async function listenChallenges() {
  const challenges = streamUrl(`${BASE_URL}/api/stream/event`);
  challenges.on('event', (event) => {
    if (event.type === 'challenge') {
      if (event.challenge.challenger.id === 'w3cj') {
        updateChallenge(event);
      } else {
        updateChallenge(event, 'decline');
      }
    }
    if (event.type === 'gameStart') {
      startGame(event);
    }
    console.log(event);
  });
}

function init() {
  listenChallenges();
}

init();
