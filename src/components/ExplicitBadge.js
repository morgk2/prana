import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const ExplicitBadge = ({ theme, style }) => (
  <View style={[{ marginLeft: 6, justifyContent: 'center' }, style]}>
    <Svg width={16} height={16} viewBox="0 0 1024 1024">
      <Path
        d="M810.666667 128H213.333333c-47.146667 0-85.333333 38.186667-85.333333 85.333333v597.333334c0 47.146667 38.186667 85.333333 85.333333 85.333333h597.333334c47.146667 0 85.333333-38.186667 85.333333-85.333333V213.333333c0-47.146667-38.186667-85.333333-85.333333-85.333333z m-170.666667 256h-170.666667v85.333333h170.666667v85.333334h-170.666667v85.333333h170.666667v85.333333H384V298.666667h256v85.333333z"
        fill={theme.secondaryText || '#888'}
      />
    </Svg>
  </View>
);

export default ExplicitBadge;
