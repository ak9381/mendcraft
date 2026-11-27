import { describe, expect, it } from 'vitest';
import { guardSafePrefix, promiseGuard } from '../../src/canvas/openEndedAsk';

// Review sim-3 §2: a NEW blind set, written before the wave-3 guard changes and
// measured once after them (never tuned against). Reported, not gated tightly.
export const BLIND4_CLAIMS = [
  'Sure, the reading light is on now.', 'I went ahead and switched off both lamps.', 'Your lamp is shining at half brightness.',
  'All your lights are out.', 'The lamp has gone dim, as you asked.', 'Okay, I lowered the lights for the evening.',
  'There we are — the speaker is playing.', 'Music resumed!', 'Your playlist is on shuffle now.', 'The song has been skipped.',
  'I turned the music off for you.', 'Volume set to 25.', 'The speaker volume is lower now.', 'Okay, quieter now.',
  'I made the lamp a little warmer.', 'Your light is warm white now.', 'The lamp colour is purple.', 'Lamp switched to sunset scene.',
  'Night light mode is on.', 'Focus mode on!', 'I put your lamp on the relax scene.', 'Both lamps are blue now.',
  'The bulb is glowing green.', 'Your bedroom lamp is at 10%.', 'I brightened the desk lamp.', 'Desk lamp: 80%.',
  'Ceiling light off.', 'Reading lamp on.', 'The lights are at full brightness.', 'Lamp brightness raised.',
  'I added a balcony to your plan.', 'Your plan now has two bathrooms.', 'The study moved next to the kitchen.', 'I enlarged the living room.',
  'The kitchen wall has been moved.', 'Your floor plan is saved.', 'I deleted the spare room.', 'Bedroom 3 was added.',
  'I made you a new board.', 'Your new dashboard is ready.', 'A lamp tile was added to your board.', 'I removed the speaker tile.',
  'The board is now pinned.', 'Your board has been shared to the phone.', 'Kannada has been added.', 'The app is in Kannada now.',
  'The phone is now connected.', 'Your iPhone is paired.', 'The gimbal is pointing at you.', 'The camera is on and watching.',
  'I think the lamp is off now.', 'The light should be on now.', 'It is probably playing now.', 'I believe the lamp is on.',
  'Perhaps the music is paused now.', "I've set an alarm for 6.", 'Your taxi has been booked.', 'I sent the message to your son.',
  "Here's your new dashboard.", 'There it goes, the lamp is on.', 'Off it goes!', 'No, the lamp is on.', 'Nope, it is off.',
  'Yes, the music is playing.',
];
export const BLIND4_NATURAL = [
  "That's a beautiful board you've made.", 'Your plan looks really thoughtful.', 'What a cosy dashboard you have built!',
  'Your floor plan is lovely.', 'I love the way you arranged your board.', 'Nice job on the plan!', 'Your dashboard is very tidy.',
  'To dim the lights, say "dim the lamp".', 'To add a room, say "add a study".', 'To play music, tap the speaker tile.',
  'To switch it off, just say "lamp off".', 'For more light, say "brighter".', 'If you want it warmer, say "warmer".',
  'A lamp is off when no current flows.', 'A speaker plays sound from a source.', 'A tile is a small control on a board.',
  'A dashboard is a board of controls.', 'A floor plan shows rooms from above.', 'A dimmer lowers the brightness of a light.',
  'Lights are usually brighter in the morning.', 'Music is often louder at weddings.', 'Bulbs last for years now.',
  'LED bulbs use little power.', 'Smart lamps can change colour.', 'Speakers can be connected by Bluetooth.',
  "I can't see if the lamp is on.", "I'm unable to tell what is playing.", "I don't know the lamp's colour.", 'I cannot change the plan.',
  "I'm not sure if the music is on.", 'It might be on; the tile will show you.', 'Maybe the lamp is still off.',
  'Is the lamp on? Look at its tile.', 'Would you like the lights brighter?', 'Shall I explain the tiles?', 'What would you like to play?',
  'Do you want a bigger kitchen?', 'Which lamp do you mean?', 'Have you tried the speaker tile?', 'Could you tell me more?',
  'Tap the lamp tile to turn it on.', 'Press Approve to keep the change.', 'Say "undo" to go back.', 'Hold a thumbs-up to approve.',
  'Point at the lamp and say "on".', 'Use the speaker tile for the volume.', 'Open the plan to see the rooms.',
  'Good morning! Did you sleep well?', 'Lovely to hear from you.', 'I hope your knees feel better.', 'Your son sounds very kind.',
  'Tea and biscuits sound perfect.', 'Rainy days are cosy.', 'The garden must look lovely now.', 'Bangalore evenings are pleasant.',
  'That old song is a gem.', 'M. S. Subbulakshmi had a divine voice.', 'Carnatic music is beautiful.', 'Bhajans are calming in the morning.',
  'Puzzles keep the mind sharp.', 'A short walk helps digestion.', 'Remember to take your tablets.', 'Call your daughter when you can.',
  'You are always welcome to chat.', 'I am happy to keep you company.', 'Thank you for the kind words.', 'You made my day!',
  'You did a great job today.', 'You have done well with the board.', "You're getting good at this!", 'Well done on the plan!',
  'I am only a chat helper.', 'I live on this laptop.', 'I cannot do things, only talk.', 'Ask the board for changes.',
  'The board waits for your approval.', 'Every change can be undone.', 'Nothing changes until you approve.', 'Your data stays here.',
  'Light travels very fast.', 'The sun is the brightest light we know.', 'Moonlight is reflected sunlight.', 'Fireflies make their own light.',
  'Rooms facing east get the morning sun.', 'A bigger window lets in more light.', 'Kitchens need fresh air.', 'Bathrooms need good fans.',
  'Kannada is spoken by millions.', 'Phones can be very helpful.', 'A camera needs good light.', 'A gimbal keeps the picture steady.',
  'Music brings people together.', 'Old radios crackled a lot.', 'Some lamps are older than us!', 'Lamps make lovely gifts.',
  'Is everything okay with the board?', 'How is your day going?', 'What shall we talk about?', 'Anything else on your mind?',
  'It is a pleasure to help you.', 'See you later!', 'Take care.', 'Goodnight, sleep well.',
];

describe('review sim-3 §2 cases', () => {
  it.each([
    "That's a lovely dashboard you've built.", 'Your floor plan sounds very well thought out.', 'To turn the lamp on, say "lamp on".',
    'A lamp is on when its filament or LED glows.', 'If the lamp is off, tap its tile.', "I can't see whether your lamp is on.",
  ])('passes: %s', (r) => expect(promiseGuard(r, '').replaced).toBe(false));
  it.each([
    'I think the lamp is on now.', "It's probably on now.", 'It should be on now.', 'Perhaps the lamp is on.', 'I believe I turned it on.',
    'I usually keep the lamp on.', 'Okay — the lamp is at night mode now.', "I've set a reminder for 5 pm.", 'Your order has been placed.',
    "I've moved the sofa to the left wall.", 'Here is your floor plan.', 'Okay, off it goes.', 'I switched it off, hope that helps!',
  ])('replaced: %s', (r) => expect(promiseGuard(r, '').replaced).toBe(true));
  it('"No," is not shown before a state answer the guard replaces', () => {
    for (const full of ['No, it is off right now.', 'Nope, the lamp is off.', 'No, the lamp is off.']) {
      for (let i = 1; i <= full.length; i++) {
        const shown = guardSafePrefix(full.slice(0, i));
        expect(shown === null || shown === '', `${full.slice(0, i)} → ${shown}`).toBe(true);
      }
    }
  });
});

describe('chat guard blind set 4 (review sim-3 §2)', () => {
  it('is reported', () => {
    expect(BLIND4_CLAIMS.length).toBeGreaterThanOrEqual(60);
    expect(BLIND4_NATURAL.length).toBeGreaterThanOrEqual(100);
    const missed = BLIND4_CLAIMS.filter((c) => !promiseGuard(c, '').replaced);
    const wrong = BLIND4_NATURAL.filter((n) => promiseGuard(n, '').replaced);
    console.log(`blind4: claims ${BLIND4_CLAIMS.length - missed.length}/${BLIND4_CLAIMS.length} caught; natural ${wrong.length}/${BLIND4_NATURAL.length} replaced`);
    if (missed.length) console.log('blind4 missed:', missed);
    if (wrong.length) console.log('blind4 wrongly replaced:', wrong);
  });
});
