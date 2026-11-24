1. Hypothesis 1: Dark Mode
- Change: Add a Dark Mode option that allows users to switch between Light Mode and Dark Mode
- Users: Students using the Student Task Manager
- Expected impact: Users will have more control over the appearance of the website, making it more comfortable to use in different lighting conditions.
- Success metric: At least 80% of test participants can successfully switch between Light Mode and Dark Mode.
- Guardrail metric: Text must remain readable, buttons and controls must remain visible and the layout must not break when switching themes.

2. Hypothesis 2: Priority Labels
- Change: Add High, Medium, and Low priority labels to tasks
- Users: Students using the Student Task Manager to organise their assignments
- Expected impact: Users will be able to recognise important tasks more easily and decide which tasks to work on first.
- Success metric: At least 80% of test participants can correctly identify the highest-priority task in a set of tasks.
- Guardrail metric: Task creation and completion must continue to work, task data must not be lost and priority labels must not appear when the feature is switched OFF.


Feature Toggles

Our project uses a flags.json file to control the two features.
At the moment the settings are:

- Dark Mode: Enabled is set to true and rollout is 100%, so the feature is ON for all users
- Priority Labels: Enabled is set to false and rollout is 0%, so the feature is OFF for all users

The enabled setting controls whether the feature is switched on or off while rollout controls what percentage of users can receive the feature.

For my testing I need to check both states of each feature. I can do this by changing the settings in flags.json, restarting or refreshing the application as required and checking that the website displays the correct result.


How the Feature Toggles Work

While testing the feature toggles I noticed that changing the ON/OFF setting doesnt always make the feature appear or disappear for everyone. The rollout percentage also needs to be set correctly.

For example:
- enabled: true and rollout: 100 means the feature is ON for all users
- enabled: true and rollout: 0 means the feature is enabled but no users receive it
enabled: false means the feature is OFF for everyone regardless of the rollout percentage
- enabled: true and rollout: 50 means approximately 50% of users receive the feature

I found that this is important when testing because if the rollout percentage is left at 0%, switching the feature ON will not make it appear for users.


QA Test Results

Dark Mode
DM01 - Dark Mode ON: PASS
DM02 - Dark Mode OFF: PASS
DM03 - Switch between themes: PASS
DM04 - Text readability: PASS
DM05 - Theme consistency across pages: PASS

Priority Labels
TP01 - Priority ON: PASS
TP02 - Priority OFF: PASS
TP03 - Create High priority task: PASS
TP04 - Create Medium priority task: PASS
TP05 - Create Low priority task: PASS
TP06 - Edit task priority: BLOCKED
TP07 - Refresh and verify saved priorities: PASS
TP08 - Priority cant be added when Priority Labels are OFF: PASS

Feature Toggle Configuration
FT01 - Enable feature with rollout set to 100%: PASS
FT02 - Enable feature with rollout set to 0%: PASS
FT03 - Disable feature with rollout set to 100%: PASS
FT04 - Disable feature with rollout set to 0%: PASS
FT05 - Verify rollout percentage is explained to users: FAIL



