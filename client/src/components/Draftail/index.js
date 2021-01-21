import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { DraftailEditor } from 'draftail';
import { EditorState, RichUtils } from 'draft-js';

import { IS_IE11, STRINGS } from '../../config/wagtailConfig';

import Icon from '../Icon/Icon';

export { default as Link } from './decorators/Link';
export { default as Document } from './decorators/Document';
export { default as ImageBlock } from './blocks/ImageBlock';
export { default as EmbedBlock } from './blocks/EmbedBlock';

import ModalWorkflowSource from './sources/ModalWorkflowSource';
import Tooltip from './Tooltip/Tooltip';
import TooltipEntity from './decorators/TooltipEntity';
import EditorFallback from './EditorFallback/EditorFallback';

// 1024x1024 SVG path rendering of the "↵" character, that renders badly in MS Edge.
const BR_ICON = 'M.436 633.471l296.897-296.898v241.823h616.586V94.117h109.517v593.796H297.333v242.456z';

/**
 * Registry for client-side code of Draftail plugins.
 */
const PLUGINS = {};

const registerPlugin = (plugin) => {
  PLUGINS[plugin.type] = plugin;
  return PLUGINS;
};

/**
 * Wraps a style/block/entity type’s icon with an icon font implementation,
 * so Draftail can use icon fonts in its toolbar.
 */
export const wrapWagtailIcon = type => {
  const isIconFont = type.icon && typeof type.icon === 'string';
  if (isIconFont) {
    return Object.assign(type, {
      icon: <Icon name={type.icon} />,
    });
  }

  return type;
};

class DraftailInlineAnnotation {
  constructor(entityKey, initialRef, getEditorState, setEditorState, editor) {
    this.entityKey = entityKey;
    this.getEditorState = getEditorState;
    this.setEditorState = setEditorState;
    this.editor = editor;
    this.ref = initialRef;
    this.setHidden = null;
    this.setFocused = null;
    this.onClickHandler = null;
  }
  onDelete() {
    this.editor.onRemoveEntity(this.entityKey, '');
  }
  onDecoratorAttached(ref, setHidden, setFocused) {
    this.ref = ref;
    this.setHidden = setHidden;
    this.setFocused = setFocused;
  }
  onFocus() {
    if (this.setFocused) {
      this.setFocused(true);
    }
  }
  onUnfocus() {
    if (this.setFocused) {
      this.setFocused(false);
    }
  }
  show() {
    if (this.setHidden) {
      this.setHidden(false);
    }
  }
  hide() {
    if (this.setHidden) {
      this.setHidden(true);
    }
  }
  setOnClickHandler(handler) {
    this.onClickHandler = handler;
  }
  onClick() {
    if (this.onClickHandler) {
      this.onClickHandler()
    }
  }
  getDesiredPosition() {
    const node = this.ref.current;
    if (node) {
      return node.getBoundingClientRect().top + document.documentElement.scrollTop
    }
    return 0
  }
}

class DraftailCommentWidget {
  constructor(
    fieldNode
  ) {
    this.fieldNode = fieldNode;
    this.contentpath = 'test_content_path'; 
    this.commentsEnabled = false;
    this.annotations = new Map();
    this.makeComment = null;
    this.setEditorState = null;
    this.getEditorState = null;
  }
  onRegister(makeComment) {
    this.makeComment = makeComment;
  }
  setEnabled(enabled) {
    // Update whether comments are enabled for the page
    this.commentsEnabled = enabled;
  }
  onChangeComments(comments) {
    // Receives a list of comments for the widget's contentpath
    this.commentNumber = comments.length;
  }
  //getAnnotationForComment(comment) {
  //  return new BasicFieldLevelAnnotation(this.fieldNode, annotationNode);
  //}
  getPlugin() {
    const plugin = {
      initialize: (PluginFunctions) => {
        window.commentApp.registerWidget(this);
        this.setEditorState = PluginFunctions.setEditorState;
        this.getEditorState = PluginFunctions.getEditorState;
      }
    }
    return plugin;
  }
  getControl() {

  }
  getSource() {
    const CommentSource = ({ editorState, entityType, onComplete }) => {
      useEffect(() => {
        const content = editorState.getCurrentContent();
        const contentWithEntity = content.createEntity(
          entityType.type,
          "MUTABLE",
          { 
            hidden: false,
            focused: false,
          },
        )
        const selection = editorState.getSelection();
        const entityKey = contentWithEntity.getLastCreatedEntityKey()
        const nextState = RichUtils.toggleLink(editorState, selection, entityKey);

        const annotation = new DraftailInlineAnnotation(entityKey, {current: this.fieldNode}, this.getEditorState, this.setEditorState, this.fieldNode.draftailEditor);
        this.annotations.set(entityKey, annotation);
        this.makeComment(annotation, this.contentpath);
        onComplete(nextState);
        }, []
    );
      return null
    };
    return CommentSource;
  }
  getDecorator() {
    const CommentDecorator = ({ entityKey, children }) => {
      const [hidden, setHidden] = useState(false);
      const [focused, setFocused] = useState(false);
      const annotationNode = useRef(null);
      useEffect(() => {
        this.annotations.get(entityKey).onDecoratorAttached(annotationNode, setHidden, setFocused);
      });
      const onClick = () => {
        this.annotations.get(entityKey).onClick()
      }

      if (hidden) {
        return <span ref={annotationNode}>{children}</span>
      }
    
      return (
        <button type="button" className="button unbutton" style={{'text-transform': 'none', 'background-color': focused ? '#01afb0' : '#007d7e'}} ref={annotationNode} onClick={onClick} data-annotation>
          {children}
        </button>
      )
    }
    return CommentDecorator
  }
}

/**
 * Initialises the DraftailEditor for a given field.
 * @param {string} selector
 * @param {Object} options
 * @param {Element} currentScript
 */
const initEditor = (selector, options, currentScript) => {
  // document.currentScript is not available in IE11. Use a fallback instead.
  const context = currentScript ? currentScript.parentNode : document.body;
  // If the field is not in the current context, look for it in the whole body.
  // Fallback for sequence.js jQuery eval-ed scripts running in document.head.
  const field = context.querySelector(selector) || document.body.querySelector(selector);

  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'Draftail-Editor__wrapper';
  editorWrapper.setAttribute('data-draftail-editor-wrapper', true);

  field.parentNode.appendChild(editorWrapper);

  const serialiseInputValue = rawContentState => {
    field.rawContentState = rawContentState;
    field.value = JSON.stringify(rawContentState);
  };

  const blockTypes = options.blockTypes || [];
  const inlineStyles = options.inlineStyles || [];
  let entityTypes = options.entityTypes || [];

  entityTypes = entityTypes.map(wrapWagtailIcon).map((type) => {
    const plugin = PLUGINS[type.type];

    // Override the properties defined in the JS plugin: Python should be the source of truth.
    return Object.assign({}, plugin, type);
  });

  const enableHorizontalRule = options.enableHorizontalRule ? {
    description: STRINGS.HORIZONTAL_LINE,
  } : false;

  const rawContentState = JSON.parse(field.value);
  field.rawContentState = rawContentState;

  const editorRef = (ref) => {
    // Bind editor instance to its field so it can be accessed imperatively elsewhere.
    field.draftailEditor = ref;
  };

  // TODO: add app check
  console.log(field);
  const comments = new DraftailCommentWidget(field);
  console.log(comments);

  const commentEntity = {
    type: "COMMENT",
    label: "Comment",
    description: "Comment",
    icon: <Icon name="comment"/>,
    source: comments.getSource(),
    decorator: comments.getDecorator(),
  }
  entityTypes.push(commentEntity);

  const editor = (
    <EditorFallback field={field}>
      <DraftailEditor
        ref={editorRef}
        rawContentState={rawContentState}
        onSave={serialiseInputValue}
        placeholder={STRINGS.WRITE_HERE}
        spellCheck={true}
        enableLineBreak={{
          description: STRINGS.LINE_BREAK,
          icon: BR_ICON,
        }}
        showUndoControl={{ description: STRINGS.UNDO }}
        showRedoControl={{ description: STRINGS.REDO }}
        maxListNesting={4}
        // Draft.js + IE 11 presents some issues with pasting rich text. Disable rich paste there.
        stripPastedStyles={IS_IE11}
        {...options}
        plugins={[comments.getPlugin()]}
        blockTypes={blockTypes.map(wrapWagtailIcon)}
        inlineStyles={inlineStyles.map(wrapWagtailIcon)}
        entityTypes={entityTypes}
        enableHorizontalRule={enableHorizontalRule}
      />
    </EditorFallback>
  );

  ReactDOM.render(editor, editorWrapper);
};

export default {
  initEditor,
  registerPlugin,
  // Components exposed for third-party reuse.
  ModalWorkflowSource,
  Tooltip,
  TooltipEntity,
};
