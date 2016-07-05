/**
 * Copyright 2015 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {BaseElement} from './base-element';
import {BaseTemplate, registerExtendedTemplate} from './service/template-impl';
import {dev} from './log';
import {getMode} from './mode';
import {getService} from './service';
import {installActionServiceForDoc} from './service/action-impl';
import {installFramerateService} from './service/framerate-impl';
import {installGlobalSubmitListener} from './document-submit';
import {installHistoryService} from './service/history-impl';
import {installImg} from '../builtins/amp-img';
import {installPixel} from '../builtins/amp-pixel';
import {installResourcesService} from './service/resources-impl';
import {installStandardActionsForDoc} from './service/standard-actions-impl';
import {installStyles} from './styles';
import {installTemplatesService} from './service/template-impl';
import {installUrlReplacementsService} from './service/url-replacements-impl';
import {installVideo} from '../builtins/amp-video';
import {installViewerService} from './service/viewer-impl';
import {installViewportService} from './service/viewport-impl';
import {installVsyncService} from './service/vsync-impl';
import {installXhrService} from './service/xhr-impl';
import {isExperimentOn, toggleExperiment} from './experiments';
import {registerElement} from './custom-element';
import {registerExtendedElement} from './extended-element';
import {resourcesFor} from './resources';
import {viewerFor} from './viewer';
import {viewportFor} from './viewport';
import {waitForBody} from './dom';


/** @const @private {string} */
const TAG = 'runtime';

/** @type {!Array} */
const elementsForTesting = [];


/**
 * Install runtime-level services.
 * @param {!Window} global Global scope to adopt.
 */
export function installRuntimeServices(global) {
  // TODO(dvoytenko, #3742): Split into runtime and ampdoc services.
  installViewerService(global);
  installViewportService(global);
  installHistoryService(global);
  installVsyncService(global);
  installResourcesService(global);
  installFramerateService(global);
  installUrlReplacementsService(global);
  installXhrService(global);
  installTemplatesService(global);
  if (isExperimentOn(global, 'form-submit')) {
    installGlobalSubmitListener(global);
  }
}


/**
 * Install ampdoc-level services.
 * @param {!./service/ampdoc-impl.AmpDoc} ampdoc
 */
export function installAmpdocServices(ampdoc) {
  // TODO(dvoytenko, #3742): Split into runtime and ampdoc services.
  installActionServiceForDoc(ampdoc);
  installStandardActionsForDoc(ampdoc);
}


/**
 * Install builtins.
 * @param {!Window} global Global scope to adopt.
 */
export function installBuiltins(global) {
  installImg(global);
  installPixel(global);
  installVideo(global);
}


/**
 * Applies the runtime to a given global scope.
 * Multi frame support is currently incomplete.
 * @param {!Window} global Global scope to adopt.
 */
export function adopt(global) {
  // Tests can adopt the same window twice. sigh.
  if (global.AMP_TAG) {
    return;
  }
  global.AMP_TAG = true;
  // If there is already a global AMP object we assume it is an array
  // of functions
  const preregisteredElements = global.AMP || [];

  global.AMP = {
    win: global,
  };

  /**
   * Registers an extended element and installs its styles.
   * @param {string} name
   * @param {!Function} implementationClass
   * @param {string=} opt_css Optional CSS to install with the component.
   *     Typically imported from generated CSS-in-JS file for each component.
   */
  global.AMP.registerElement = function(name, implementationClass, opt_css) {
    const register = function() {
      registerExtendedElement(global, name, implementationClass);
      elementsForTesting.push({
        name,
        implementationClass,
        css: opt_css,
      });
      // Resolve this extension's Service Promise.
      getService(global, name, () => {
        // All services need to resolve to an object.
        return {};
      });
    };
    if (opt_css) {
      installStyles(global.document, opt_css, register, false, name);
    } else {
      register();
    }
  };

  /** @const */
  global.AMP.BaseElement = BaseElement;

  /** @const */
  global.AMP.BaseTemplate = BaseTemplate;

  /**
   * Registers an extended template.
   * @param {string} name
   * @param {!Function} implementationClass
   */
  global.AMP.registerTemplate = function(name, implementationClass) {
    registerExtendedTemplate(global, name, implementationClass);
  };

  installRuntimeServices(global);
  const viewer = viewerFor(global);

  /** @const */
  global.AMP.viewer = viewer;

  if (getMode().development) {
    /** @const */
    global.AMP.toggleRuntime = viewer.toggleRuntime.bind(viewer);
    /** @const */
    global.AMP.resources = resourcesFor(global);
  }

  // Experiments.
  /** @const */
  global.AMP.isExperimentOn = isExperimentOn.bind(null, global);
  /** @const */
  global.AMP.toggleExperiment = toggleExperiment.bind(null, global);

  const viewport = viewportFor(global);

  /** @const */
  global.AMP.viewport = {};
  global.AMP.viewport.getScrollLeft = viewport.getScrollLeft.bind(viewport);
  global.AMP.viewport.getScrollWidth = viewport.getScrollWidth.bind(viewport);
  global.AMP.viewport.getWidth = viewport.getWidth.bind(viewport);

  /**
   * Registers a new custom element.
   * @param {function(!Object)} fn
   */
  global.AMP.push = function(fn) {
    // Extensions are only processed once HEAD is complete.
    waitForBody(global.document, () => {
      fn(global.AMP);
    });
  };

  /**
   * Sets the function to forward tick events to.
   * @param {function(string,?string=,number=)} fn
   * @param {function()=} opt_flush
   * @deprecated
   * @export
   */
  global.AMP.setTickFunction = (fn, opt_flush) => {};

  // Execute asynchronously scheduled elements.
  // Extensions are only processed once HEAD is complete.
  waitForBody(global.document, () => {
    for (let i = 0; i < preregisteredElements.length; i++) {
      const fn = preregisteredElements[i];
      try {
        fn(global.AMP);
      } catch (e) {
        // Throw errors outside of loop in its own micro task to
        // avoid on error stopping other extensions from loading.
        dev.error(TAG, 'Extension failed: ', e);
      }
    }
    // Make sure we empty the array of preregistered extensions.
    // Technically this is only needed for testing, as everything should
    // go out of scope here, but just making sure.
    preregisteredElements.length = 0;
  });
}


/**
 * Registers all extended elements as normal elements in the given
 * window.
 * Make sure to call `adopt(window)` in your unit test as well and
 * then call this on the generated iframe.
 * @param {!Window} win
 */
export function registerForUnitTest(win) {
  for (let i = 0; i < elementsForTesting.length; i++) {
    const element = elementsForTesting[i];
    if (element.css) {
      installStyles(win.document, element.css, () => {
        registerElement(win, element.name, element.implementationClass);
      }, false, element.name);
    } else {
      registerElement(win, element.name, element.implementationClass);
    }
  }
}
