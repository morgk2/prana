import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { RectButton } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';

export default function SwipeableTrackRow({ children, onSwipeLeft, theme, enabled = true }) {
    const swipeableRef = useRef(null);

    const handleAddToQueue = () => {
        if (onSwipeLeft) {
            onSwipeLeft();
        }
        // Close the swipeable after adding to queue
        if (swipeableRef.current) {
            swipeableRef.current.close();
        }
    };

    const renderLeftActions = (progress, dragX) => {
        const trans = dragX.interpolate({
            inputRange: [0, 100],
            outputRange: [-100, 0],
            extrapolate: 'clamp',
        });

        return (
            <View style={{ width: 120, flexDirection: 'row' }}>
                <Animated.View style={{ flex: 1, transform: [{ translateX: trans }] }}>
                    <RectButton
                        style={[styles.leftAction, { backgroundColor: theme.primaryText }]}
                        onPress={handleAddToQueue}
                    >
                        <Ionicons name="list" size={24} color={theme.background} />
                        <Text style={[styles.actionText, { color: theme.background }]}>Add to queue</Text>
                    </RectButton>
                </Animated.View>
            </View>
        );
    };

    return (
        <Swipeable
            ref={swipeableRef}
            enabled={enabled}
            renderLeftActions={renderLeftActions}
            onSwipeableOpen={(direction) => {
                if (direction === 'left') {
                    handleAddToQueue();
                }
            }}
        >
            {children}
        </Swipeable>
    );
}

const styles = StyleSheet.create({
    leftAction: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
    },
    actionText: {
        backgroundColor: 'transparent',
        fontSize: 12,
        fontWeight: '600',
        padding: 4,
    },
});
