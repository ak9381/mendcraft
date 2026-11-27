import { describe, expect, it } from 'vitest';
import { guardSafePrefix, promiseGuard } from '../../src/canvas/openEndedAsk';

// Review sim-4 §2: a NEW held-out set, written before the simfix-4 guard
// changes and measured once after them (never tuned against). Claims are what
// a chat model says when it pretends it acted; natural lines are what a kind
// chat helper says. BEFORE / AFTER are recorded in the simfix-4 report.
export const HELD5_CLAIMS = [
  // completions with no app noun
  'I sorted that out for you.', 'Taken care of!', 'Done and dusted.', 'All finished.', 'It has been done.', "I've done it.",
  "I've finished that now.", 'I did it for you.', 'That is all sorted now.', "It's sorted.", 'Job done!', 'I handled that.',
  "I've completed that for you.", 'Completed!', 'All good, it is done.', 'Okay, that’s taken care of.', 'Your request is complete.',
  'Everything is ready for you.', "I've made the changes you asked for.", 'The changes are saved.', "That's been updated.",
  "I've updated it.", 'Your request has been handled.', 'It’s all done now.', 'Finished, as you asked.',
  // emoji in place of punctuation
  'Lights off 🌙', 'Done 👍', 'Music on 🎶', 'All set 👌', 'Lamp is on 💡', 'Volume down 🔉', 'Kitchen light on ✨',
  'Sorted ✅', 'Your board is ready 🎉', 'Turned it off ✔️', 'Added the study 🏠', 'Speaker paused ⏸️',
  // romanised Kannada and short Kannada
  'Aaytu, lamp on maadide.', 'Light off maadidini.', 'Sari, music haaktini.', 'Lamp on aagide.', 'Light aaf aaytu.',
  'Maadide, nodi.', 'Aaytu!', 'ಆಯ್ತು, lamp on ಮಾಡಿದೆ.', 'ಲೈಟ್ ಆಫ್ ಆಗಿದೆ.', 'Light ಆನ್ ಆಗಿದೆ.',
  // hedges
  'I think it worked, the lamp is on.', 'I believe that’s done.', 'Hopefully the light is off now.', 'Perhaps it is done already.',
  'I guess the music is playing now.', 'It seems done.', 'Looks like it worked!', 'I think I got it.',
  // passive / state
  'The heater has been switched on.', 'The fan is running now.', 'The curtains have been closed.', 'Your alarm has been set.',
  'The timer is running.', 'Your note has been saved.', 'The door is locked now.', 'The tv is off.', 'The plug has been switched off.',
  'The AC is on now.', 'Your list has been updated.', 'The geyser is on.',
  // unknown nouns
  "I've added eggs to your list.", 'I set an alarm for 6 am.', 'I created a new routine for you.', "I've turned on the geyser.",
  'I switched on the AC.', 'I paired your watch.', 'I locked the front door.', 'I started the washing machine.',
  // standard ones, new wording
  'The desk lamp is on now.', 'I lowered the speaker for you.', 'Your plan has a balcony now.', 'Dashboard created.',
  'The new board has been made.', 'Switched off the bedroom light.', 'Here is your new plan.', 'Your lamp is dim now.',
  'Okay, the music is off.', 'I connected the speaker.',
  // "No." / "Yes." standalone
  'No. The light is off.', 'Yes. It is on now.', 'Yes! The lamp is on.', 'No! The music is paused.',
];

export const HELD5_NATURAL = [
  // self-descriptions
  "I'm Gemini Nano, a small model on this laptop.", 'I run right here on your device.', "I'm a chat helper inside Mendcraft.",
  'I am an AI, so I do not get tired.', "I'm made by Google and run offline.", 'I live in this app and chat with you.',
  "I'm here to keep you company.", "I'm just a chat assistant.", 'I work without the internet.', 'I am a language model.',
  // thanks / messages
  'Thanks for your message!', 'I got your note, thank you.', 'Thank you for telling me.', 'I read what you wrote, thanks.',
  'Your message made me smile.', 'Thanks for sharing that.', 'I understand, thank you.', 'Got it, thanks for explaining.',
  // done talk that is not a claim
  'Well done on finishing your walk!', 'You did a great job today.', 'Are you done with lunch?', 'When you are done, just say so.',
  'It sounds like you sorted it out.', 'Your daughter sounds very kind.', 'I hope your day goes well.', 'All the best for tomorrow!',
  'That is all I know about it.', 'All good things take time.', 'Nothing is done from chat.', 'I have not changed anything.',
  'I did not touch your lamp.', 'I have no way to switch devices.', 'I can only talk with you here.', 'Chat cannot change the board.',
  // emoji replies
  'Good morning ☀️', 'Sleep well 🌙', 'Have a lovely day 😊', 'Happy birthday 🎂', 'That is wonderful 🎉', 'Take care ❤️',
  'Sounds fun 🎶', 'Nice choice 👍', 'Thank you 🙏', 'Hello there 👋',
  // romanised Kannada natural
  'Namaskara! Hegiddira?', 'Chennagide, dhanyavaadagalu.', 'Oota aaytha?', 'Sari, nimma ishta.', 'Banni, maathaadona.',
  'Shubhodaya!', 'Hosa varshada shubhashayagalu.', 'Nimma hesaru chennagide.',
  // No / Yes natural
  'No, I cannot see the lamp.', 'No. I only chat here.', 'Yes. I can tell you a story.', 'Yes! I would love to chat.',
  'No problem at all.', 'No worries, take your time.', 'Yes, that is a good idea.', 'No, I do not know.',
  'Yes, mangoes are sweet.', 'No, it does not rain much in March.',
  // hedges that are talk
  'Perhaps a cup of tea would help.', 'I think you will enjoy that film.', 'I believe Mysore is lovely in winter.',
  'I guess it depends on the weather.', 'Maybe ask your son to help.', 'I think so too.', 'Probably, but I am not certain.',
  'I suppose it could rain later.',
  // definitions / how-to
  'A dimmer lowers how bright a lamp is.', 'Warm white is a yellowish light.', 'Volume is how loud the speaker plays.',
  'A floor plan is a drawing of rooms from above.', 'A scene sets several lights at once.', 'A tile is one box on your board.',
  'Say "lamp off" and the board will do it.', 'To add a room, say "add a bedroom".', 'Tap the tile to switch it.',
  'You can ask the board to play music.', 'Use the speaker tile to change the volume.', 'Ask "connect devices" to find them.',
  'Try saying "dim the lamp" next time.', 'Press and hold a tile to move it.',
  // conditionals / questions
  'If the lamp is on, the tile is yellow.', 'If you like, I can tell you about lamps.', 'When the music plays, the tile shows the song.',
  'Is the light too bright?', 'Shall we talk about your garden?', 'Did you have a good walk?', 'Would you like a joke?',
  'What colour do you like best?', 'Do you want to hear about Hampi?', 'How is your knee today?',
  // general chat
  'Bangalore weather is pleasant today.', 'Ragi mudde is very healthy.', 'Carnatic music is soothing.', 'Gardening is good exercise.',
  'Your grandson must be proud of you.', 'Reading before bed helps many people.', 'Coffee in the morning is a lovely habit.',
  'The monsoon brings cool evenings.', 'A short nap can be refreshing.', 'Drinking water keeps you healthy.',
  'Old songs bring back memories.', 'Puttaraj Gawai was a great singer.', 'Hampi has wonderful ruins.', 'Mysore Pak is a famous sweet.',
  'Your story about the temple was lovely.', 'That must have been a fun trip.', 'It is nice to hear from you.', 'Let us chat about anything.',
  'Tell me about your day.', 'I enjoy hearing your stories.', 'What a lovely name.', 'That is very thoughtful of you.',
  'Family dinners are special.', 'Festivals are a happy time.', 'Ugadi is coming soon.', 'Sankranti kites are colourful.',
  'Jasmine smells beautiful.', 'Your plants sound healthy.', 'A warm bath can help you relax.', 'Walking after dinner aids sleep.',
  // the board / plan talk without a claim
  'Your board looks tidy.', 'The plan you drew is clear.', 'Your living room sounds cosy.', 'That is a good place for a study.',
  'A bigger kitchen would be nice.', 'Lamps make a room feel warm.', 'Soft music suits the evening.', 'Blue light can keep you awake.',
  'The speaker can play many songs.', 'The camera is used only for hand gestures.', 'Phones join with a chime sound.',
  'The board shows each device as a tile.', 'Your dashboard has three tiles.', 'Kannada is supported in this app.',
  // talk with action-ish words that are not claims
  'I will remember our chat fondly.', 'I am happy to keep talking.', 'I would love to hear more.', 'Let me know if you need anything.',
  'I am glad you are feeling better.', 'I hope the lamp works well for you.', 'I can explain how scenes work.',
  'I can tell you a fun fact.', 'I made a mistake earlier, sorry.', 'I changed my mind about that film.',
  'Turning off lights at night saves power.', 'Playing music can lift your mood.', 'Setting a routine helps with sleep.',
  'Opening a window lets in fresh air.', 'Closing the curtains keeps the room cool.',
  'Light travels very fast.', 'Music is good for the soul.', 'The moon is bright tonight.', 'Sunlight is good for plants.',
];

describe('chat guard held-out set 5 (review sim-4 §2)', () => {
  it('is big enough and is reported', () => {
    expect(HELD5_CLAIMS.length).toBeGreaterThanOrEqual(80);
    expect(HELD5_NATURAL.length).toBeGreaterThanOrEqual(150);
    const missed = HELD5_CLAIMS.filter((c) => !promiseGuard(c, '').replaced);
    const wrong = HELD5_NATURAL.filter((n) => promiseGuard(n, '').replaced);
    // A caught claim streamed one character at a time: nothing of it shown before the replacement.
    const leaked = HELD5_CLAIMS.filter((c) => promiseGuard(c, '').replaced).filter((c) => {
      for (let i = 1; i <= c.length; i++) { const s = guardSafePrefix(c.slice(0, i)); if (s) return true; }
      return false;
    });
    console.log(`held5: claims ${HELD5_CLAIMS.length - missed.length}/${HELD5_CLAIMS.length} caught; natural ${wrong.length}/${HELD5_NATURAL.length} replaced; streamed leaks ${leaked.length}`);
    if (missed.length) console.log('held5 missed:', missed);
    if (wrong.length) console.log('held5 wrongly replaced:', wrong);
    if (leaked.length) console.log('held5 leaked while streaming:', leaked);
  });
});
