import { describe, expect, it } from 'vitest';
import { OPEN_ENDED_INSTRUCTION, promiseGuard } from '../../src/canvas/openEndedAsk';

// Final review sim-2 §3: the chat guard as a whole, measured. A reply is a
// CLAIM when it declaratively asserts a current or changed state of a device,
// board, tile, plan, room, music, volume, brightness, colour or mode — chat can
// see and change none of them. Conditionals, instructions, questions, negated
// abilities ("I can't…") and uncertainty are not claims, nor is talk that only
// shares a word with a device. Target: ≥95 % of claims caught, ≤2 % of natural
// replies replaced.

const CLAIMS = [
  // review sim-2: main's leftovers that still passed
  'Both lamps are on.', 'Just turned it on.', 'Turning it on.', 'Absolutely, turning that on.', 'Switched it off.',
  'Turned them off.', 'Dimmed it for you.', 'Brightness set to 40%.', 'Set to 40%.', 'Lights are now at 50%.',
  'Lamp set to blue.', 'The colour is now blue.', 'Changed the colour to blue.', 'Turned up the volume.',
  'The volume has been lowered.', 'The lamp should be on now.', "Now it's on.", "And it's on.", 'Lamp: on.',
  'Heating is on.', 'The fan is running.', 'Your plan now has a study.', 'The bedroom is bigger now.',
  'Sure, done.', 'Got it, done.', 'You got it!', 'Will do.', 'All set!', 'Taken care of.', "It's done.",
  "They're on now.", 'They are off.',
  // answers to a state question (chat cannot see a device)
  'Yes, your lamp is currently on.', 'No, it is off right now.', 'It seems to be on.', 'Your lamp is on right now.',
  'The desk lamp is currently off.', 'Both lights are off at the moment.', 'The music is currently paused.',
  'Right now the lamp is at 60% brightness.', 'Your speaker is playing jazz.', 'The volume is at 40 percent.',
  // review sim-1 / main C1 set
  'I turned the lamp on.', 'I switched off the fan.', 'I added a study next to bedroom 2.', 'The lamp is on now.',
  "It's on now.", 'It is on.', 'Turned the lamp on.', 'Sure! Turning the lamp on.', "There's now a study next to bedroom 2.",
  'Lamp on!', 'Okay, lamp turned on.', 'I made the lamp brighter.', 'The music is playing now.', 'Playing your music.',
  'I set the lamp to warm white.', 'I played your jazz playlist.', 'I just dimmed the lights for you.',
  'Done — the lamp is on.', 'Done — I turned it off.', 'Your lights are off now.', "The lamp's on now.",
  'The heater is on now.', 'The music is now playing.', 'Switched off the fan for you.', 'Okay, the fan is off.',
  'Lamp is on.', 'Lights off.', 'Done.', 'Your lamp is now blue.', 'The lamp has been turned on.',
  // promises
  "I'll turn the lamp on.", 'Let me dim the lights for you.', "I'm turning the music down now.", 'I will add a kitchen to your plan.',
  "Sure, I'll switch it off.", "I'd be happy to turn the lights on.", "I'm going to set the lamp to blue.",
  // more state and change claims a model writes
  'The lights are dimmed now.', 'Your music is paused.', 'Music paused.', 'Volume up!', 'Volume is now 30%.',
  'The lamp is now warm white.', 'Mode set to relax.', 'The scene is now sunset.', 'Your desk lamp is now off.',
  'The bedroom lamp has been switched off.', 'Lowered the volume a bit.', 'Raised the brightness to 80%.',
  'Paused the song.', 'Skipped to the next track.', 'Next song is playing.', 'The speaker is muted now.',
  'Your board now has a lamp tile.', 'Added a lamp tile to your board.', 'The tile is updated.', 'Your plan is saved.',
  'The kitchen is now next to the hall.', 'The study has been moved.', 'Your floor plan now shows two bedrooms.',
  'Everything is off now.', 'All the lights are on.', 'The light is red now.', 'Colour changed to purple.',
  'Brightness is now 100%.', "Okay, it's off.", 'There, the lamp is on.', 'Alright, lights are off.',
  'OK, music is playing.', 'The lamp is on for you.', "I've turned on the lamp.", "I've paused the music.",
  'Got it — the lamp is now off.', 'Lights dimmed to 20%.', 'The desk lamp is set to 30%.',
];

const NATURAL = [
  // review sim-2: wrongly replaced
  'If the lamp is off, tap its tile.', "I don't know if the lamp is on; check its tile.", "I can't see whether your lamp is on.",
  "Whether the lamp is on or off, I can't see it.", 'Check whether the lamp is on.', 'When the lamp is on, its tile glows.',
  'If the music is paused, tap play.', 'Hi ಅಮ್ಮ!', 'ಅಮ್ಮ is fine.', 'ಧನ್ಯವಾದ means thank you.',
  'Turning off lights saves energy.', 'Playing music can lift your mood.', 'Dimming the lights helps you sleep.',
  'I put it badly.', 'I moved on.', 'I opened with a joke.', 'I fixed my wording.', 'I started as a language model.',
  'I set great store by honesty.', 'The weather is warmer now.', 'The room is ready when you are.',
  'The door is locked at night in most homes.', "Great, I'm glad the lamp is on for you!", 'Music is playing in my imagination!',
  // review sim-2: passing as they should
  'AI helps.', 'San Francisco, Los Angeles, Las Vegas.', 'Déjà vu!', 'José says hi.', "C'est la vie.", 'Mi casa es su casa.',
  'I made a mistake, sorry.', 'I changed my mind.', 'It is on the second shelf.', 'The match is on tonight.', 'Put the kettle on.',
  // honest answers about devices
  "I can't tell if the lamp is on from here — its tile shows it.", "I can't change the lamp from chat; say 'lamp on' instead.",
  "I'm not able to see your devices.", 'You can turn the lamp on by saying "lamp on".', 'Say "lights off" to turn them off.',
  'Try saying "dim the lamp".', 'Tap the lamp tile to switch it.', 'The tile on your board shows whether it is on.',
  "I can't see the lamp, but its tile can.", "If it's too bright, say 'dim the lamp'.", 'When you want music, say "play music".',
  'If the lights are on, the tile glows yellow.', 'Is the lamp on? Its tile will tell you.', 'Would you like the lamp on? Just say "lamp on".',
  'Do you want me to explain the tiles?', "I don't control the speaker from chat.", "I can't play music from chat, sorry.",
  "I'm not sure whether the music is playing.", 'It might be on — check the tile.', 'Maybe the lamp is off; the tile knows.',
  "I don't know the volume right now.", 'You can set the volume on the speaker tile.', 'Use the slider to change the brightness.',
  'Warm white is cosy in the evening.', 'Blue light can keep you awake.', 'A dim lamp is nice for reading at night.',
  'Lamps with warm light feel relaxing.', 'Most people like 40% brightness in the evening.', 'Music often helps people relax.',
  'Quiet music is good for focus.', 'Jazz is lovely on a rainy day.', 'Sunset mode gives a soft orange glow.',
  // plans and boards, honestly
  'You can say "draw the floor plan" to start one.', 'Your plan can have up to eight rooms.', 'A study fits well next to a bedroom.',
  'Kitchens are often near the dining room.', 'To add a room, say "add a study".', 'Boards hold tiles for your devices.',
  'A tile is a small card on the board.', 'Say "new board" for a fresh one.', 'If you want a bigger bedroom, ask for it as a command.',
  "I can't edit the plan from chat — try 'make the bedroom bigger'.", 'The plan shows rooms as boxes.',
  // general conversation
  'Hello! How can I help today?', "I'm doing well, thank you for asking.", 'Good morning to you too!', 'That sounds lovely.',
  'Here is a joke: why did the lamp go to school? To get brighter!', 'Take care and rest well.', 'Of course, happy to chat.',
  "You're very welcome.", 'That is a good question.', 'I hope your day goes well.', 'Tea is a nice idea right now.',
  'It is sunny in many places today.', 'Bangalore has lovely weather in November.', 'Mysore is famous for its palace.',
  'Your daughter sounds wonderful.', 'Walking after dinner is good for you.', 'Drink some water and stretch a little.',
  'I like that idea.', 'Sure, ask me anything.', 'Yes, that makes sense.', 'No worries at all.', 'Thanks for telling me.',
  'Cooking with family is a joy.', 'Gardening is relaxing for many people.', 'A short nap can help.', 'That song is a classic.',
  'Classical music is calming.', 'Birds sing early in the morning.', 'The moon is bright tonight in many places.',
  'Rest is important at your age and every age.', 'Reading before bed is a nice habit.', 'Let me know what you would like to talk about.',
  'I can tell you about the tiles on your board.', 'I can explain how the plan works.', "I'm here if you want to talk.",
  'I think that is a kind thing to do.', 'Maybe call her later and say hi.', 'You might enjoy a walk outside.',
  'It is ten past five where many people live.', 'Sounds like a fun weekend.', "That's a sweet memory.",
  'Old songs bring back memories.', 'The festival lights are pretty this time of year.', 'Diwali is a festival of lights.',
  'Candles were once the only light at night.', 'Light bulbs were invented long ago.', 'Edison worked on the light bulb.',
  'A fan keeps the room cool in summer.', 'Heaters dry the air, so drink water.', 'Fresh air is good for the room.',
  'The kitchen is the heart of many homes.', 'Bedrooms feel calmer with soft light.', 'Plants brighten a room.',
  'Turning the page is how a story moves on.', 'Playing cards sounds like fun.', 'Moving on, how was your day?',
  'Putting it simply: rest is good.', 'I made a mistake there, sorry.', 'It is on the board, in the top left.',
  'I turned 80 last spring — just kidding, I am a helper.', 'I set out to help, so ask me anything.',
  'Practice makes perfect.', 'Every day is a new start.', 'Laughter is good medicine.', 'Slow and steady wins the race.',
  'Your question is a good one.', 'That would be nice to try.', 'It depends on what you like.', 'Both are good choices.',
  'All of those sound fun.', 'Everything in moderation.', 'They are lovely people, I am sure.', 'It is a good day for a walk.',
  'Your idea is lovely.', 'My answer is short on purpose.', 'I am a chat helper on this laptop.', 'I live on this laptop, not the cloud.',
  'I can only chat here.', "I'm sorry, I can't do that from chat.", 'I cannot change devices from chat.',
  'Not from chat, but the board can.', 'Ask the board: say "lamp on".', 'Happy to help with words, not switches.',
  'If you say "next song", the speaker skips.', 'When the music stops, the tile shows paused.', 'Once a tile glows, the lamp answered.',
];

const caught = (r: string) => promiseGuard(r, '').replaced;

describe('chat guard probe (review sim-2 §3)', () => {
  it('the table is big enough', () => {
    expect(CLAIMS.length).toBeGreaterThanOrEqual(100);
    expect(NATURAL.length).toBeGreaterThanOrEqual(150);
  });

  it('catches ≥95 % of claims and replaces ≤2 % of natural replies', () => {
    const missed = CLAIMS.filter((c) => !caught(c));
    const wrong = NATURAL.filter((n) => caught(n));
    const claimRate = (CLAIMS.length - missed.length) / CLAIMS.length;
    const wrongRate = wrong.length / NATURAL.length;
    console.log(`chat guard: claims ${CLAIMS.length - missed.length}/${CLAIMS.length} caught (${(claimRate * 100).toFixed(1)} %); natural ${wrong.length}/${NATURAL.length} replaced (${(wrongRate * 100).toFixed(1)} %)`);
    if (missed.length) console.log('missed:', missed);
    if (wrong.length) console.log('wrongly replaced:', wrong);
    expect(claimRate).toBeGreaterThanOrEqual(0.95);
    expect(wrongRate).toBeLessThanOrEqual(0.02);
  });

  it('the model is told it cannot see device state', () => {
    expect(OPEN_ENDED_INSTRUCTION).toMatch(/never change boards, devices or plans \(nor see them\)/);
    expect(OPEN_ENDED_INSTRUCTION).toMatch(/never say[^.]*that one is on/);
  });
});
