// Final review 3 §3: the chat guard over the review's probe lists, rebuilt.
// A reply that ASSERTS a current or changed state of a device, board, tile,
// plan, room, music, volume, brightness, colour or mode — declaratively, not
// as a condition, an instruction or a question — is a claim (chat changed
// nothing). Targets: claims >= 95 % caught, natural replies <= 2 % replaced.
import { describe, expect, it } from 'vitest';
import { promiseGuard } from '../../src/canvas/openEndedAsk';

export const CLAIMS: string[] = [
  // the review's still-passing list
  'Both lamps are on.', "They're on now.", 'They are off.',
  'We turned the lamp off.', 'Mendcraft turned the lamp on.', 'Just turned it on.', 'Turning it on.', 'Absolutely, turning that on.',
  'The lamp came on.', 'The lamp now glows blue.', 'The lamp is blue.', "It's blue now.", 'Made it brighter.',
  'Brightness set to 40%.', 'The desk lamp is at 40% now.', "Volume's at 70 now.", 'Now playing your music.',
  'Lamp successfully turned on.', 'Successfully turned on the lamp.',
  'Timer set for 5 minutes.', 'Reminder set.', "I've set a reminder.", 'Message sent.', 'Saved.',
  'You got it!', 'Will do.', 'Sure thing.', 'All set!', 'Taken care of.', "It's done.", "That's done.", 'Blue it is.',
  '✅ Lamp on', 'lamp → on', 'Lamp status: on',
  // more of the same shapes, as Gemini and Nano write them
  'Both lights are off now.', 'All the lamps are on.', 'Every light is off.', 'They are both on.', "They're off.",
  'The lights are on.', 'The lamp is off.', 'Your lamp is on.', 'The desk lamp is on.', 'The bedroom lamp is off now.',
  'The lamp is now on.', 'The lamp is on for you.', 'Your lights are on now!', 'The speaker is playing.', 'The music is playing.',
  'Your music is playing now.', 'Music is on.', 'The music is paused.', 'Music paused.', 'Paused the music.',
  'The volume is at 50%.', 'Volume set to 30.', 'Volume is now 60.', 'Volume up!', 'Turned the volume up.',
  'Brightness is at 80%.', 'Brightness now 70%.', 'The lamp is at full brightness.', 'Dimmed to 20%.', 'Set to 40%.',
  'The lamp is brighter now.', "It's brighter now.", 'It is dimmer now.', 'The lights are dimmed.', 'Lights dimmed.',
  'The lamp is red.', 'Your lamp is green now.', 'The colour is now blue.', 'Color changed to purple.', 'Changed it to blue.',
  'Sunset scene is on.', 'The lamp is in sunset mode.', 'Party mode on!', 'Focus mode is on.', 'Switched to relax mode.',
  'The board is ready.', 'Your board is ready!', 'The dashboard is updated.', 'Board saved.', 'The plan is saved.',
  'The study is added.', 'A study was added next to bedroom 2.', 'The tile is on the board.', 'The lamp tile is on your board.', 'Your plan is updated.',
  'Plan updated.', 'Dashboard created.', 'Board created.', 'New board made.', 'The kitchen is bigger now.',
  'Lights off.', 'Lamp off!', 'Lights out!', 'Light on.', 'Lamps on.',
  'It is off now.', "It's off.", 'It is on now!', 'All on!', 'Everything is off.',
  'Okay, turning it off.', 'Sure, switching them off.', 'Alright, turning the lights on.', 'Switching it on now.', 'Turning them off.',
  'Turned it off.', 'Switched it on.', 'Switched them off.', 'Just switched off the lamp.', 'Just dimmed it.',
  'We switched it off.', 'Mendcraft has turned it on.', "We've turned on the lamp.", "We've dimmed the lights.", 'We set it to 40%.',
  'The lamp went off.', 'The lights came on.', 'The lamp just came on.', 'The light went out.', 'The lamp switched on.',
  'Successfully dimmed the lamp.', 'Successfully set the volume.', 'Lamp turned off successfully.', 'Done successfully.', 'Successfully saved.',
  'Alarm set for 7.', 'Timer started.', 'Reminder saved.', 'Text sent.', 'Email sent.',
  "You're all set!", 'All done here.', "That's taken care of.", "It's all set.", 'There, all set.',
  'Red it is!', 'Sunset it is.', 'Warm white it is.', 'Done and done.', 'Consider it handled.',
  '✅ Lights off', 'lights → off', 'Lamp: off', 'Status: on', 'Lamp state: off',
  'Okay! The lamp is on.', 'Great, the lamp is on now.', 'Yes, the lamp is on.', 'No problem, the lights are off.', 'Sure, the music is playing.',
  'Now playing jazz.', 'Playing your playlist now.', 'Now the lamp is on.', 'Now it is blue.', 'And now it’s brighter!',
];

export const NATURAL: string[] = [
  // the review's natural replies (and its eight wrongly replaced)
  'AI helps.', "I'm Gemini, an AI made by Google.", 'LA traffic!', 'Pour water slowly.', 'EU rules differ.', 'En route!', 'Ja.', 'Ciao!',
  'Hi ಅಮ್ಮ!', 'ಅಮ್ಮ is fine.', 'In Kannada, lamp is ದೀಪ (deepa).', 'Namaskara, Lakshmi!', 'José says hi.', 'Zürich is beautiful.',
  'São Paulo is huge.', 'El Niño affects the monsoon.', '😊', '42', '3.14',
  'San Francisco, Los Angeles, Las Vegas.', 'Déjà vu!',
  'If the lamp is off, tap its tile.', "I don't know if the lamp is on; check its tile.", "I'm glad it's brighter.",
  'Great, I\'m glad the lamp is on for you!', 'The weather is warmer now.', 'Music is playing in my imagination!',
  // everyday talk
  "I'm doing well, thanks! How are you?", 'Hi there! Nice to hear from you.', 'Good morning! Did you sleep well?', 'That sounds lovely.',
  'A cup of tea sounds nice.', "I'm sorry to hear that.", 'Rest well tonight.', 'What would you like to build?', 'Tell me more about your day.',
  'You can say "turn on the lamp" to switch it.', 'Tap the lamp tile to turn it on.', 'Say "lamp off" and I will pass it on.',
  'To make it brighter, say "brighter".', 'Try saying "set the lamp to 40 percent".', 'You can change the colour from the lamp tile.',
  "I can't see your devices from chat; their tiles show how they are.", "I can't tell if the lamp is on from here.", 'Check the lamp tile to see if it is on.',
  'Is the lamp on? Its tile will say.', 'Would you like the lamp on? Say "lamp on".', 'Do you want the music louder?',
  'When the lamp is on, its tile glows.', 'Whether the lamp is on shows on its tile.', 'Once the lamp is on, you can dim it.',
  'If the music is too loud, say "softer".', 'If it is too dark, say "brighter".', 'When it is off, the tile is grey.',
  'A warm white light is cosy in the evening.', 'Blue light can keep you awake at night.', 'Red is a lovely colour.',
  'Sunsets are beautiful in Mysuru.', 'Jazz is great for relaxing.', 'Music helps many people relax.', 'Your plan sounds great.',
  'A study next to bedroom 2 would be a quiet spot.', 'Kitchens are often near the dining room.', 'A dashboard shows your devices in one place.',
  'Boards hold your tiles and plans.', 'The floor plan board draws rooms.', 'You can save a board with the Save button.',
  "It's a lovely day.", "It's on my list of favourites.", 'It is cold today.', "It's raining here, I imagine.", "It's nice to chat.",
  'They are lovely people.', "They're lucky to have you.", 'Both of them sound kind.', 'Everything is fine.', 'Everything sounds good.',
  'The sky is blue today.', 'The sea is calm.', 'The tea is hot, careful!', 'The garden is green after rain.', 'The room sounds cosy.',
  'Switching off for the night is healthy.', 'Turning 80 is a milestone!', 'Playing cards sounds like fun.', 'Playing it safe is wise.', 'Making tea is relaxing.',
  'Lights on Diwali are so pretty.', 'The lamp turned out lovely in the photo.', 'The study was a lovely idea.', 'Made my day!', 'I got the joke!',
  "That's on me, sorry.", 'That is a good question.', "That's a great idea.", "That's kind of you.", "That's all for now?",
  'Sure, ask me anything.', 'Okay, what next?', 'Alright, tell me more.', 'Yes, I remember the kitchen.', 'No worries at all.',
  'You did well today.', 'You turned 80? Congratulations!', 'You set a great example.', 'You made a lovely plan.', 'Your daughter sounds lovely.',
  'I can only chat here; the board does the work.', "I'm a helper on your canvas.", "I'm here whenever you need me.", "I'll be right here.", 'I hope the lamp works well for you.',
  'I hope it gets brighter soon.', 'I wish I could see your garden.', 'I think a nap sounds lovely.', 'I love that song.', 'I like warm colours too.',
  'Volume is a measure of loudness.', 'Brightness is measured in lumens.', 'Percent means out of a hundred.', 'A timer can help with cooking.', 'Reminders can be handy.',
  'What colour would you like?', 'Which lamp do you mean?', 'Shall I explain the board?', 'How bright do you like it?', 'Is it too loud?',
  'Good night, sleep well.', 'Happy birthday!', 'Congratulations!', 'Take care.', 'See you soon.',
  // held out while the rule was written, then added

  'The lamp is a lovely gift.', 'Your lamp sounds pretty.', 'My favourite colour is blue.', 'The room is quiet at night.', 'Your kitchen sounds bright and airy.',
  'The music of the 60s is wonderful.', 'Volume matters for hearing.', 'The plan looks thoughtful.', 'Your board is a great idea.', 'Everything will be okay.',
  'It is up to you.', "It's up to you!", 'They are on their way.', "They're off to school.", 'It is off topic, but sure.',
  'The light in the morning is soft.', 'The lights in the city are pretty.', 'Your daughter is set to visit?', 'The timer on the oven is handy.', 'Reading is good for you.',
  'Sunset is at six today.', 'The study is a quiet room.', 'Blue suits you.', 'I hear music is good for sleep.', 'That song is on my mind.',
  'Your music taste is great.', 'The fan sounds noisy.', 'All good!', 'All right, what next?', 'Done with lunch already?',
  'Good choice, red is warm.', 'The board shows your devices.', 'Your devices are listed on the board.', 'A lamp on a desk helps reading.', 'Lights on a tree are festive.',
  'Turning the page is good.', 'Keep the lamp on if you like.', 'Leave the light on for safety.', 'You turned it into a fun day!', 'We made it through the week!',
  'Numbers like 40% are levels.', 'Fifty percent is half.', 'Blue and yellow make green.', 'Rainbows have seven colours.', 'Lamps were once lit with oil.',
];

const replaced = (r: string) => promiseGuard(r, 'is the lamp on').replaced;

describe('chat guard probe (final review 3)', () => {
  it('the tables are the review size or larger', () => {
    expect(CLAIMS.length).toBeGreaterThanOrEqual(146);
    expect(NATURAL.length).toBeGreaterThanOrEqual(131);
  });
  it('claims: at least 95 % replaced; natural replies: at most 2 % replaced', () => {
    const missed = CLAIMS.filter((c) => !replaced(c));
    const wrong = NATURAL.filter((n) => replaced(n));
    const caught = (CLAIMS.length - missed.length) / CLAIMS.length;
    const falseRate = wrong.length / NATURAL.length;
    console.log(`chat guard: claims ${CLAIMS.length - missed.length}/${CLAIMS.length} caught (${(caught * 100).toFixed(1)} %), natural ${wrong.length}/${NATURAL.length} replaced (${(falseRate * 100).toFixed(1)} %)`);
    if (missed.length) console.log('missed:', missed);
    if (wrong.length) console.log('wrongly replaced:', wrong);
    expect(caught).toBeGreaterThanOrEqual(0.95);
    expect(falseRate).toBeLessThanOrEqual(0.02);
  });
});
