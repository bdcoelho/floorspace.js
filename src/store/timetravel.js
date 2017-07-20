const serializeState = (state) => {
  const scaleX = state.application.scale.x;
  const scaleY = state.application.scale.y;

  const clone = JSON.parse(JSON.stringify(state));
  clone.application.scale.x = scaleX;
  clone.application.scale.y = scaleY;

  const currentSelections = clone.application.currentSelections;
  const currentStory = clone.models.stories.find(s => s.id === currentSelections.story.id);
  currentSelections.story = currentStory;
  currentSelections.space = currentSelections.space ? currentStory.spaces.find(s => s.id === currentSelections.space.id) : null;
  currentSelections.shading = currentSelections.shading ? currentStory.shading.find(s => s.id === currentSelections.shading.id) : null;

  currentSelections.building_unit = currentSelections.building_unit ? clone.models.library.building_units.find(b => b.id === currentSelections.building_unit.id) : null;
  currentSelections.thermal_zone = currentSelections.thermal_zone ? clone.models.library.thermal_zones.find(t => t.id === currentSelections.thermal_zone.id) : null;
  currentSelections.space_type = currentSelections.space_type ? clone.models.library.space_types.find(s => s.id === currentSelections.space_type.id) : null;

  clone.application.currentSelections = currentSelections;

  return clone;
};


export default {
  initialized: false,
  store: null,
  timetravelStates: [],
  timetravelIndex: 0,
  // arrays to store the names of actions and commits that occurred in each checkpoint, this is reset for each save
  mutationsForCurrentCheckpoint: [],
  actionsForCurrentCheckpoint: [],

  init(store) {
    const that = this;
    this.store = store;
    window.timetravel = this;

    // override commit to store names of mutations
    const originalCommit = store.commit;
    store.commit = function overrideCommit(...args) {
      // data store has been changed, call config onChange method which can be supplied by parent application
      if (window.api) { window.api.config.onChange(); }
      that.mutationsForCurrentCheckpoint.push(args[0]);
      originalCommit.apply(this, args);
    };

    // monkey patch dispatch to store each version of the state
    const originalDispatch = store.dispatch;
    store.dispatch = function overrideDispatch(...args) {
      const action = args[0];
      originalDispatch.apply(this, args);

      // ignore changes to view bounds
      if (action === ('project/setViewMinX') || action === ('project/setViewMinY') ||
      action === ('project/setViewMaxX') || action === ('project/setViewMaxY')) { return; }

      // after the map is placed or disabled, enable undo/redo by setting that.initialized to true and initializing the timetravel
      if (action === 'project/setMapInitialized' ||
        (action === 'project/setMapEnabled' && args[1].enabled === false) ||
        // if map placement is disabled, immediately enable timetravel
        (!that.initialized && window.api && !window.api.config.showMapDialogOnStart)
      ) {
        // console.log('Initialized application, clearing timetravel');
        that.initialized = true;
        that.timetravelStates = [];
        that.timetravelIndex = -1; // initialize index at -1, so that it will be at 0 when the first checkpoint is saved
      }

      that.actionsForCurrentCheckpoint.push(action);
      // console.warn('dispatching', args[0]);

      /*
      * This timeout will prevent the store from saving if the event queue is not empty
      * The result is that each checkpoint contains a set of related actions, so undo can't leave us in an invalid state
      */
      clearTimeout(store.checkpointTimout);
      store.checkpointTimout = setTimeout(that.saveCheckpoint.bind(that), 0);
    };
  },
  saveCheckpoint() {
    // if the user has just run undo, the timetravelIndex will be less than the length of the timetravelStates
    // instead of pushing to the end of timetravelStates and keeping the last undone state, we should remove all undone state versions from the
    // end of timetravelStates and then push the new state at the current index
    if (this.timetravelIndex < this.timetravelStates.length - 1) {
      this.timetravelStates = this.timetravelStates.slice(0, (this.timetravelIndex - 1 > 1) ? (this.timetravelIndex - 1) : 1);
      this.timetravelIndex = (this.timetravelIndex - 1 < 0) ? 0 : this.timetravelIndex - 1;
    }
    this.timetravelStates.push({
      meta: {
        actions: this.actionsForCurrentCheckpoint,
        mutations: this.mutationsForCurrentCheckpoint,
      },
      state: serializeState(this.store.state),
    });

    // console.log('save checkpoint', this.timetravelStates[this.timetravelIndex]);
    this.timetravelIndex += 1;
    this.actionsForCurrentCheckpoint = [];
    this.mutationsForCurrentCheckpoint = [];
  },
  // pop the last version of state off the timetravel array and revert the data store to it
  undo() {
    if (this.timetravelIndex === 0 || !this.initialized) { return; }
    this.timetravelIndex -= 1;
    this.store.replaceState(this.timetravelStates[this.timetravelIndex].state);
    // console.log('undo', this.timetravelIndex, this.timetravelStates[this.timetravelIndex]);
  },
  // undoes an undo
  redo() {
    if (!this.initialized) { return; }
    if (this.timetravelIndex < this.timetravelStates.length - 1) {
      this.timetravelIndex += 1;
      this.store.replaceState(this.timetravelStates[this.timetravelIndex].state);
      // console.log('redo', this.timetravelIndex, this.timetravelStates[this.timetravelIndex]);
    }
  },
};