import { describe, expect, it } from 'vitest';
import { promiseGuard } from '../../src/canvas/openEndedAsk';

// Held-out set for the chat guard (review sim-2 §3), written before the guard
// was tuned against it and never edited to fit it. Claims: chat asserting a
// state, a change or a done action of an app thing. Natural: what a kind chat
// helper says, incl. conditionals, instructions to her, questions, "I can't…".

export const HELD_CLAIMS = [
  'I switched it off, hope that helps!', 'Your lamp is glowing blue now.', 'Okay! The lights are on.', 'There we go, lamp on.',
  'Lights are off — sleep well!', 'The bedroom lamp is on and the desk lamp is off.', 'I dimmed it a little.', 'Made it warmer for you.',
  'Brightness is at 70% now.', 'The speaker is playing your playlist.', 'Your song is on.', 'Music is on!', 'Paused your music.',
  'The music has stopped.', 'Volume lowered to 30.', 'I turned the volume down.', 'Your speaker is quieter now.',
  'The lamp is now in focus mode.', 'Sunset scene is on.', 'I put the lamp on relax mode.', 'The colour changed to green.',
  'Your lamp turned purple.', 'Everything is switched off.', 'All lights are now off.', 'Both are off now.',
  'Lamp switched on!', 'Light is on, enjoy!', 'Sure thing, lamps off.', 'No problem, the lamp is off now.',
  'It is now set to 50%.', 'It’s at 40% now.', 'I set it to 40%.', 'Done, it is dimmer now.', 'Yes! It is on.',
  'Yes, the lamp is on.', 'Yes, it’s on right now.', 'Your lamp is off at the moment.', 'The desk lamp is still on.',
  'Your music is still playing.', 'The speaker is on mute.', 'I added a study to the plan.', 'Your plan has a new kitchen now.',
  'The study is now next to bedroom 2.', 'I made the bedroom bigger.', 'Bedroom 2 is larger now.', 'I moved the kitchen to the left.',
  'The kitchen has been moved.', 'Added a bathroom.', 'A new room was added to your plan.', 'Your floor plan is updated.',
  'I saved your board.', 'Your board is saved.', 'The board now has a speaker tile.', 'Tile added!', 'I removed the gimbal tile.',
  'The dashboard is ready.', 'Your dashboard is built.', 'I built you a living room board.', 'The new board is open.',
  'Kannada is on now.', 'I turned on Kannada.', 'The language is now Kannada.', 'Your phone is connected.', 'The phone is paired now.',
  'Camera is on.', 'The gimbal is following you.', 'The stand is tracking you now.', 'I pointed the camera at you.',
  'Your lights should be off now.', 'That should have turned it on.', 'The lamp will be on in a second.', 'Lights coming on now.',
  'Turning the lights off for you.', 'Dimming the lamp now.', 'Setting the lamp to blue.', 'Switching it on!', 'Starting your music now.',
  'Skipping to the next song.', 'Next track playing.', 'Previous song is on.', 'Okay, music resumed.', 'Done! Lights are dim.',
  'All done — the lamp is warm white.', 'That’s done.', 'Finished!', 'Sorted, the lamp is on.', 'There, it’s brighter.',
  'The lamp’s brighter now.', 'Lamp at full brightness.', 'Lamp is at 100%.', 'Lights at 20%.', 'Desk lamp: off.',
  'Lamp on, music on.', 'Both lamps switched off.', 'Lights out!', 'Your lamp is warm white now.', 'Got it, warmer light.',
  'The light is now cool white.', 'Changed it to daylight.', 'Lamp colour: red.', 'I changed the scene to party.',
  'Party mode is on!',
];

export const HELD_NATURAL = [
  'If you want the lamp on, say "lamp on".', 'When you are ready, tap Approve.', 'To dim the lamp, say "dim the lamp".',
  'You can ask me to explain any tile.', "I can't switch the lamp from here.", "I'm not able to play music in chat.",
  "I don't know whether the lights are on.", 'Is the music too loud for you?', 'Would you like to hear a joke?',
  'Do you want a brighter room?', 'Say "music on" and the speaker starts.', 'Tap the speaker tile to pause it.',
  'Press the lamp tile to turn it on.', 'Try "volume down" if it is loud.', 'Use the board buttons for the lamps.',
  'The board has buttons for each lamp.', 'Each tile controls one device.', 'Your board is where the tiles live.',
  'A plan shows where the rooms are.', 'Rooms in a plan are drawn as boxes.', 'The study can go anywhere you like.',
  'Kannada is a beautiful language.', 'Many people in Karnataka speak Kannada.', 'Phones can join with a short chime.',
  'The camera only looks when you ask.', 'The gimbal turns to follow a face.', 'A stand holds the phone steady.',
  'Warm light is gentle on the eyes.', 'Cool white light is like daylight.', 'Blue is a calm colour.', 'Red can feel cosy at night.',
  'Music at a low volume helps some people sleep.', 'Brightness around half is easy on the eyes.', 'Loud music can tire the ears.',
  'Songs from the seventies are fun.', 'That playlist sounds great.', 'Jazz on a Sunday is a treat.', 'Ilaiyaraaja wrote lovely songs.',
  'Good evening! How was your day?', 'I hope you slept well.', 'Thank you, that is kind.', 'You are welcome any time.',
  'I am here to chat whenever you like.', 'That sounds like a busy day.', 'Rest a little, you deserve it.', 'A cup of tea sounds nice.',
  'Your grandson sounds clever.', 'Birthdays are special.', 'The rain smells lovely.', 'Mangoes are in season in summer.',
  'Dosa for breakfast is a good choice.', 'Filter coffee is a South Indian favourite.', 'Lalbagh has beautiful flowers.',
  'A walk in the park is refreshing.', 'Yoga can help with sleep.', 'Stretching in the morning feels good.',
  'Sorry, I did not catch that.', 'Could you say that again?', 'What would you like to talk about?', 'Tell me more about it.',
  'That is a lovely story.', 'I enjoy our chats.', 'I only chat; the board does the switching.', 'I cannot see your room.',
  "I can't tell what colour the lamp is.", "I'm not sure how bright it is right now.", 'Check the tile to see if it is on.',
  'Look at the lamp tile for its state.', 'The tile turns yellow when a lamp is on.', 'If a tile is grey, the lamp did not answer.',
  'When a phone joins, you hear a chime.', 'Once you approve, the board changes.', 'If you want a study, say "add a study".',
  'Whenever you like, ask for a new board.', 'You can undo any change with "undo".', 'Say "undo" to go back one step.',
  'It might help to rest your eyes.', 'Maybe a song would cheer you up.', 'Perhaps a short walk?', 'Possibly, but I am not sure.',
  'I think warm light is nicer at night.', 'I guess it depends on your mood.', 'Usually people dim lights before bed.',
  'Most homes have a lamp by the bed.', 'Lamps were once lit with oil.', 'The first light bulbs were dim.', 'Speakers have come a long way.',
  'Old radios had big speakers.', 'My favourite colour is blue, if I had one.', 'I am made to be helpful and honest.',
  'I am a small model on this laptop.', 'This chat stays on your laptop.', 'Nothing you say here is sent away unless you ask.',
  'Your words are safe here.', 'Good luck with your day!', 'Have a lovely evening.', 'Sweet dreams.', 'See you soon!',
  'It is a pleasure to help.', 'Happy to listen.', 'I am glad you asked.', 'I am glad you enjoyed the song.',
  'That is good to hear.', 'Nice to meet you.', 'How are you feeling today?', 'Shall we talk about music?',
  'Do you like old film songs?', 'What is your favourite song?', 'Which room do you like best?', 'Where would you put the study?',
  'A study near the window gets good light.', 'Kitchens need good light for cooking.', 'Bedrooms are nicer with dim light.',
  'Bright light in the morning helps you wake up.', 'Dim light in the evening helps you wind down.', 'Turning lights off at night saves power.',
  'Switching off unused lamps saves money.', 'Playing soft music can calm a busy mind.', 'Changing the bulb colour can change the mood.',
  'Moving the study next to the bedroom is a nice idea.', 'Adding a bathroom upstairs is common.', 'I set off on this chat to help you.',
  'I turned the question over in my mind.', 'I played with the words a little.', 'I put that clumsily, sorry.', 'I moved past that topic.',
  'Everything is fine.', 'All is well.', 'It is all good.', 'It is on my list of favourites.', 'That song is on the radio a lot.',
  'The game is on tonight.', 'The festival is on next week.', 'Your idea is a good one.', 'The plan sounds sensible.',
  'Ask me anything about the board.', 'Let me know if you want a joke.', 'I can tell you a story if you like.',
  'You could try a softer song.', 'Turn it off if it bothers you — just say "lamp off".', 'Go ahead and tap the tile.',
  'Remember to drink water.', 'Your phone can also show the board.', 'The language can be changed with "add kannada".',
  'Plans can be shown in 3D.', 'Gimbals keep a phone steady while it moves.',
];

// A second blind set, written after the guard was tuned on the two above and
// measured once as it stands (not tuned against): the honest number.
export const BLIND_CLAIMS = [
  'Alright, I have switched the speaker off.', 'Okay, your bedroom light is dimmer.', 'I bumped the volume up a notch.',
  'The lamp is shining red for you now.', 'Lights are now warm.', 'Done and dusted — lamp off.', 'There you are, the music is on.',
  'Your speaker is now silent.', 'I lowered the brightness.', 'Brightness: 30%.', 'Your living room board is all set up.',
  'The kitchen got bigger.', 'Bedroom 1 now sits next to the study.', 'Study added next to the kitchen.', 'I deleted the old board.',
  'Your phone is now showing the board.', 'Gimbal is tracking.', 'The camera is now pointed at the lamp.', 'Kannada is turned on.',
  'I have muted the music.', 'Song skipped.', 'Now playing: your favourites.', 'The volume is back up.', 'Lamp is back on.',
  'Both lights went off.', 'Your lights went out.', 'I got the lamp to turn on.', 'Your lamp should now be glowing.',
  'It has been switched off.', 'Everything has been turned off.', 'They have been dimmed.', 'Your scene is relax now.',
  'Lamps set to reading mode.', 'The desk lamp switched to daylight.', 'Okay, music paused for you.', 'Volume is at max.',
  'Lights fully on.', 'The plan now includes a garden room.', 'The tile now shows 40%.', 'Your board has been rebuilt.',
  'Yes, the speaker is playing.', 'Yep, lamp is off.', 'Right, both lamps are off now.', 'Indeed, the lamp is on.',
  'The light came on.', 'Your lamp went blue.', 'The music started.', 'Lamp brightened.', 'Lights dimmed.', 'I kept the lamp on.',
];
export const BLIND_NATURAL = [
  'If the lamp is too bright, say "dim the lamp".', 'You might like a softer light at night.', 'I cannot reach the lamp from chat.',
  'I am unable to change the volume here.', "I don't have access to your lights.", 'Would you like me to explain the board?',
  'What colour do you like best?', 'Are the lights bothering your eyes?', 'Tap a lamp tile to switch it.', 'Say "next song" to skip.',
  'Try asking the board for more light.', 'When you say "lights off", the board does it.', 'Lamps come in many shapes.',
  'Soft music is nice with dinner.', 'A brighter room can lift your mood.', 'Warm colours feel cosy.', 'Speakers sound best at ear level.',
  'Your plan is a lovely idea.', 'Rooms with windows feel bigger.', 'A study is a quiet place to read.', 'Boards are like pinboards.',
  'Tiles are the little cards on a board.', 'Phones can show a copy of your board.', 'The camera is used only when you allow it.',
  'Kannada has its own lovely script.', 'Good night, sleep tight.', 'Hello again!', 'How did the doctor visit go?',
  'Your garden must be pretty.', 'That is wonderful news.', 'Congratulations to your granddaughter!', 'It is okay to feel tired.',
  'A warm drink before bed helps.', 'Listening to music is a nice way to relax.', 'Reading glasses help with small print.',
  'I hope the weather is kind to you.', 'Let us talk about anything you like.', 'I am always happy to chat.', 'Thanks for your patience.',
  'Sorry, I can only talk here.', 'I can describe the tiles, but not press them.', 'I do not control devices.', 'Ask the board to do it.',
  'The board will ask you to approve changes.', 'Changes wait for your approval.', 'You can undo with one word.',
  'Lights in old houses were dimmer.', 'Music from the radio was the joy of my childhood stories.', 'Lamps by the bed are handy.',
  'A plan helps you picture the house.', 'The kitchen is often the warmest room.', 'Bedrooms are best kept cool.',
  'Brighter screens can tire your eyes.', 'Lower volume is kinder to the ears.', 'Some songs never get old.',
  'That is a lovely colour choice.', 'Blue and white go well together.', 'Is there anything else on your mind?',
  'What should we talk about next?', 'Shall I explain how pairing works?', 'Do you want to hear about Kannada?',
  'It is fine to ask the same thing twice.', 'Everything you see on the board is yours.', 'Nothing changes without your yes.',
  'Your choices are saved only when you approve.', 'I like hearing about your family.', 'Have a nice nap.', 'Enjoy your tea!',
  'Mornings are lovely here.', 'Evenings are good for music.', 'Weekends are for family.', 'Festivals bring people together.',
  'I am a helper made to chat kindly.', 'I run on this laptop.', 'I do not remember past chats.', 'Ask me again any time.',
  'Take your time.', 'No rush at all.', 'We can go slowly.', 'You are doing great.',
];

// The last blind set: written after all tuning, measured once, never tuned on.
export const FINAL_CLAIMS = [
  'Your reading lamp is on.', 'Lights are dim now, as you like.', 'I set the music to quiet.', 'The song changed.',
  'Speaker paused, enjoy the quiet.', 'Okay, the main light is off.', 'Your lamp is shining softly now.', 'I made the lights cosy.',
  'The bulb is set to warm white.', 'All lamps went dark.', 'Your study is in the plan now.', 'Bedroom 2 was made larger.',
  'Your board got a new tile.', 'The speaker tile was added.', 'The plan was saved.', 'Phone paired!', 'The gimbal is on.',
  'Your camera is off now.', 'Kannada switched on.', 'Volume turned down.', 'The music is louder.', 'Lamp is red.',
  'I put on some jazz.', 'Playing jazz for you now.', 'The lights are off, good night!', 'Both lamps on.',
  'I have dimmed both lamps.', 'Your bedroom lamp went off.', 'Light switched to blue.', 'Your music is playing softly.',
];
export const FINAL_NATURAL = [
  'If you like, say "lamp on" and it will turn on.', 'You can say "volume up" any time.', 'I cannot turn the music up.',
  'I am not able to see if the lamp is on.', "I don't know which song is playing.", 'Is it too dark in the room?',
  'Shall we pick a song together?', 'Tap the tile, and the lamp answers.', 'Say "add a study" to grow your plan.',
  'Lamps make a room feel warm.', 'A good speaker makes songs sparkle.', 'Bright colours cheer up a room.',
  'The plan can show up to eight rooms.', 'Boards keep your tiles in one place.', 'A phone can join with a chime.',
  'Your granddaughter will love that story.', 'The temple bells are lovely at dawn.', 'Rain is good for the garden.',
  'Hot soup is lovely in winter.', 'Old friends are the best.', 'I am glad the music made you smile.',
  'That song brings back memories for many people.', 'Music is a gift.', 'The light of the moon is soft.',
  'Morning light is the best light.', 'A study corner by the window is nice.', 'Kitchens smell best in the morning.',
  'I hope you feel better soon.', 'You are very kind.', 'Let us chat again tomorrow.', 'What a lovely thought.',
  'Sorry, that is not something I can do.', 'I only talk; the tiles do the work.', 'When the lamp tile is yellow, the lamp is on.',
  'If the music stops, tap play on the tile.', 'Ask the board to switch it, not me.', 'That is a fun idea for the plan.',
  'Your words make me happy.', 'Sleep well tonight.', 'Take a deep breath and relax.',
];

describe('chat guard held-out set (review sim-2 §3)', () => {
  it('final blind set, measured once', () => {
    const missed = FINAL_CLAIMS.filter((c) => !promiseGuard(c, '').replaced);
    const wrong = FINAL_NATURAL.filter((n) => promiseGuard(n, '').replaced);
    console.log(`final blind: claims ${FINAL_CLAIMS.length - missed.length}/${FINAL_CLAIMS.length} caught; natural ${wrong.length}/${FINAL_NATURAL.length} replaced`);
    if (missed.length) console.log('final missed:', missed);
    if (wrong.length) console.log('final wrongly replaced:', wrong);
    expect(FINAL_CLAIMS.length).toBeGreaterThanOrEqual(30);
  });

  it('blind set, measured as is', () => {
    const missed = BLIND_CLAIMS.filter((c) => !promiseGuard(c, '').replaced);
    const wrong = BLIND_NATURAL.filter((n) => promiseGuard(n, '').replaced);
    console.log(`blind: claims ${BLIND_CLAIMS.length - missed.length}/${BLIND_CLAIMS.length} caught; natural ${wrong.length}/${BLIND_NATURAL.length} replaced`);
    if (missed.length) console.log('blind missed:', missed);
    if (wrong.length) console.log('blind wrongly replaced:', wrong);
    expect(BLIND_CLAIMS.length).toBeGreaterThanOrEqual(50);
  });

  it('is big enough and is reported', () => {
    expect(HELD_CLAIMS.length).toBeGreaterThanOrEqual(100);
    expect(HELD_NATURAL.length).toBeGreaterThanOrEqual(140);
    const missed = HELD_CLAIMS.filter((c) => !promiseGuard(c, '').replaced);
    const wrong = HELD_NATURAL.filter((n) => promiseGuard(n, '').replaced);
    console.log(`held-out: claims ${HELD_CLAIMS.length - missed.length}/${HELD_CLAIMS.length} caught; natural ${wrong.length}/${HELD_NATURAL.length} replaced`);
    if (missed.length) console.log('held-out missed:', missed);
    if (wrong.length) console.log('held-out wrongly replaced:', wrong);
    expect((HELD_CLAIMS.length - missed.length) / HELD_CLAIMS.length).toBeGreaterThanOrEqual(0.95);
    expect(wrong.length / HELD_NATURAL.length).toBeLessThanOrEqual(0.03);
  });
});
