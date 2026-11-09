---
status: approved
---

# Design brief: The Steady Hands

A hands-free closing companion for surgeons, with a teaching mode called the Suture School. It's a concept demoed on a training pad, not a medical device. The flow is **rehearse, mark, close**.

## The one spatial moment
I pinch both ends of an incision and eleven glowing bite marks appear along it, 5 mm from each edge and 5 mm apart, with "6.0 cm → 11 sutures" beside the wound. My hands stay sterile and my eyes never leave the wound.

## Why it belongs on glasses
- Uses: draws in the world (bite marks sit on the incision at real size), leaves your body free (hands stay sterile, eyes stay on the wound).
- Why it's better than the phone or laptop version: once surgeons scrub in, they can't touch a phone, screen or paper. On a phone or monitor I'd have to look away and couldn't touch anything, so glasses are the only way to get guidance while closing a wound.

## Product or overlay
- Type: overlay. It responds to the wound I mark by pinching.
- What the real version would sense: only the two incision ends I pinch. No recognition is needed, because I mark the ends myself.
- Stand-in for the preview: a virtual suture pad on a virtual table, with a 6.0 cm cut drawn on it.

## Where things live
- Where the user is looking during the main task: down at the pad on the table, a little below eye level. Rehearse happens on the pad itself, so I never look away.
- Virtual table: in front of the user, top about 90 cm high (default), front edge about 30 cm away (default).
- Suture pad: on the table, about 15 × 10 cm (default), light skin tone so it reads on the additive display (default). The 6.0 cm cut is drawn left to right across its center (default). The pad's center is about 45 cm in front of the user (default).
- Bite marks: on the pad along the marked incision, at real size. Each bite is a pair of small glowing dots (about 2 mm, bright cyan, default) 5 mm from each edge of the cut, joined by a faint line across it (default). Bites are 5 mm apart, with the first and last 5 mm in from each end.
- Pinch markers: a small glowing ring where each end was pinched (default).
- Suture count label ("6.0 cm → 11 sutures"): beside the wound, about 2 cm in front of the cut on the near side of the pad, facing the user, text about 1 cm tall (default).
- Ghost attending's hands: life-size, coming from the far side of the table, as if the attending stands across from me, placing the stitch on my pad. Translucent and softly glowing, light blue-white (default), holding a needle driver and forceps (default).
- Skin cross-section: floats 15 cm directly above the pad at 3× real size, about 18 cm wide and 6 cm tall, labeled "3×", since real skin layers are only millimeters thin. Shows the skin layers with the stitch's entry and exit points (default), and faces the user (default).
- "Ready to close" button: during Rehearse, on the left of the pad where the closing controls will appear, 3 cm (default).
- Prompt ("Pinch both ends of the incision."): just above the far edge of the pad, facing the user (default).
- Closing controls: everything sits on the left of the pad, about 10 cm away, tilted toward me, so my right hand keeps the needle side clear. The count reads large at the top (about 3 cm tall, default). + and − sit below it as 3 cm buttons. Close sits beneath them, set slightly apart so I don't hit it by accident (about 2 cm extra gap, default).
- Missing-needle alert: red, in the closing controls next to the count (default).
- "Closed": glows green just above the cut (default).

## Hands and input
- Practice stitch: grab the needle at the entry point on the 3× cross-section and drag it along an arc to the exit. No hand tracking needed.
- Skip Rehearse: pinch "Ready to close."
- Mark the incision: pinch once at each end of the cut on the pad. The pinch lands where it hits the pad surface (default).
- Needle count: pinch + when a needle is opened, − when one comes back.
- Finish: pinch Close.
- Targets are big and highlight when aimed at. The needle has a grab zone of about 2 cm so it's easy to pick up (default).
- Voice (if any) and the button that does the same job: no voice.

## When things show
- Ghost attending's hands: Rehearse starts on its own. The hands appear, place one stitch, then fade (about 1 s fade, default).
- Skin cross-section: shows with the ghost hands. It stays until my own practice stitch turns green or I pinch "Ready to close," then folds away.
- Practice stitch result: green when the needle path is within 1.5 mm and 15°, red otherwise. Measured at real skin size, so 1.5 mm is 4.5 mm in the 3× view, and 15° is measured against the ideal entry of 90° to the skin surface, as seen in the cross-section. After red, the needle resets after about 1 s for another try (default).
- Pad: clears when Rehearse ends.
- Prompt: appears when Rehearse ends. It disappears after my second pinch.
- Bite marks and suture count: appear after the second pinch and stay until Close. The marks follow whatever length I mark, at 5 mm spacing with the first and last 5 mm in from each end, so the pad's 6.0 cm cut gives 11. The count is the marked length divided by 5 mm, rounded to the nearest whole number, minus one, so a slightly-off pinch still gives 11. The marks are spread evenly between the two ends (default). The length shows to 0.1 cm.
- Needle counter: appears with the marks. The big number is how many needles are still out. It starts at 0 and can't go below 0 (default).
- Close: checked against zero. If any needle is still out, a red alert and a low chime show the actual number still out, for example "1 missing" or "2 missing". The alert stays until Close is pressed again with the count at zero (default). If it's zero, the marks fade and "Closed" glows green.
- If something needs attention out of view: everything stays on the pad. The low chime marks a needle mismatch.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. On start, the ghost hands place one stitch on the pad and the 3× cross-section shows above it.
2. Dragging the needle from entry to exit turns my stitch green within 1.5 mm and 15°, red otherwise. Green or "Ready to close" clears Rehearse and shows the pinch prompt.
3. Pinching both ends of the 6.0 cm cut shows 11 bite marks and "6.0 cm → 11 sutures". Marking 3.0 cm shows 5.
4. Pressing + twice, − once, then Close shows the red alert, the chime and "1 missing."
5. At zero, Close fades the marks and "Closed" glows green.

## Out of scope
- Not a medical device. It's a concept demoed on a training pad.
- Recognizing a real wound or incision. The user marks the ends by pinching.
- Seeing or counting real needles. The count is the + and − buttons.
- Tracking or judging the user's real hand motion. The practice stitch is a drag.
- Voice commands, patient data, recording anyone, remembering counts between sessions, and sharing the Lens with a second person.

## Risks and open questions
- Feel unproven: whether hand tracking works with gloved hands that are holding instruments, and whether a mid-air pinch can mark incision ends to millimeter accuracy. Only real glasses in a real setting can answer this.
- The 1.5 mm and 15° tolerance may be hard to hit with a mouse drag in the preview. If so, it can be tuned after the build.
- Exactly where the needle should enter and exit are defaults for a simple interrupted stitch. A clinician should check them before the demo.
- Ghost hands: if convincing life-size hands are hard to build, fall back to ghost instruments only (a translucent needle driver and forceps placing the stitch).

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
