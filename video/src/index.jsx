import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Video, DURATION } from './Video.jsx';

const Root = () => (
  <Composition id="Vertical" component={Video} durationInFrames={DURATION} fps={30} width={1080} height={1920} />
);

registerRoot(Root);
