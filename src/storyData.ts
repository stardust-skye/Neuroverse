import type { StoryBeat } from './types'

export const story: Record<string, StoryBeat> = {
  arrival: {
    chapter: '01 / THE ARRIVAL',
    title: 'The last signal',
    text: 'Cold metal presses against your palms. Emergency lights pulse through the dark. Beyond the cracked viewport, a blue planet turns in silence.',
    dialogue: 'UNKNOWN TRANSMISSION  //  “If you can hear me, do not open the airlock.”',
    choices: [
      { label: 'Trace the transmission', next: 'trace' },
      { label: 'Check the airlock', next: 'airlock' },
    ],
  },
  trace: {
    chapter: '02 / THE SIGNAL',
    title: 'A familiar voice',
    text: 'The signal leads to the navigation core. A voice emerges from a field of static—it sounds like yours, recorded years from now.',
    dialogue: 'FUTURE YOU  //  “The station remembers. Ask it what happened.”',
    special: 'Jaw clench to amplify the signal',
    choices: [
      { label: 'Ask the station', next: 'memory' },
      { label: 'Cut the transmission', next: 'cutoff' },
    ],
  },
  airlock: {
    chapter: '02 / THE AIRLOCK',
    title: 'The other side',
    text: 'A shadow drifts outside the airlock. Its hand touches the glass in time with your heartbeat. The manual override is still live.',
    dialogue: 'STATION AI  //  “Life signs detected. Identity match: inconclusive.”',
    choices: [
      { label: 'Open the airlock', next: 'open' },
      { label: 'Seal the bulkhead', next: 'seal' },
    ],
  },
  memory: {
    chapter: '03 / THE REVEAL',
    title: 'Echoes of tomorrow',
    text: 'The station unfolds its memory: you sent the first signal, trying to guide your crew home. The shadow is only your reflection in a damaged sensor.',
    dialogue: 'STATION AI  //  “Signal source confirmed: you.”',
    choices: [
      { label: 'Send the signal home', next: 'home' },
      { label: 'Stay with the station', next: 'stay' },
    ],
  },
  cutoff: {
    chapter: '03 / SILENCE',
    title: 'A quiet orbit',
    text: 'The transmission ends. For one perfect moment the station is quiet. Then the stars shift, and you notice a new signal answering from Earth.',
    dialogue: 'SIGNAL  //  “We hear you.”',
    choices: [{ label: 'Answer the call', next: 'home' }, { label: 'Begin again', next: 'arrival' }],
  },
  open: {
    chapter: '03 / CONTACT',
    title: 'A hand in the dark',
    text: 'The airlock opens. A gloved hand reaches through, carrying the mission patch you lost as a child. The visitor is not a stranger—it is the crew you thought you had forgotten.',
    dialogue: 'CREW  //  “We came back for you.”',
    choices: [{ label: 'Return together', next: 'home' }, { label: 'Begin again', next: 'arrival' }],
  },
  seal: {
    chapter: '03 / THE LONG WAY',
    title: 'A choice to trust',
    text: 'The shadow disappears. You seal the bulkhead and follow the faint signal toward the escape pod. You will make it home—but you will always wonder.',
    dialogue: 'STATION AI  //  “Trajectory set. Good luck, captain.”',
    choices: [{ label: 'Take the long way home', next: 'home' }, { label: 'Begin again', next: 'arrival' }],
  },
  home: {
    chapter: 'FINAL / HOMECOMING',
    title: 'The signal returns',
    text: 'The blue planet fills the viewport. A thousand lights answer your signal from below. Whatever waited in the dark, you are no longer alone.',
    dialogue: 'MISSION CONTROL  //  “Welcome home, captain.”',
    ending: true,
  },
  stay: {
    chapter: 'FINAL / THE KEEPER',
    title: 'A light in the void',
    text: 'You become the station’s keeper, sending the signal forward for the next lost traveler. In the silence, a reply arrives sooner than expected.',
    dialogue: 'UNKNOWN  //  “I can hear you.”',
    ending: true,
  },
}
