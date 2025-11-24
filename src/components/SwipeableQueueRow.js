import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { RectButton } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';

export default function SwipeableQueueRow({ children, onDelete, enabled = true }) {
    const swipeableRef = useRef(null);

    const handleDelete = () => {
        if (onDelete) {
            onDelete();
        }
        // Close the swipeable after deleting
        if (swipeableRef.current) {
            swipeableRef.current.close();
        }
    };

    const renderRightActions = (progress, dragX) => {
        const trans = dragX.interpolate({
            inputRange: [-100, 0],
            outputRange: [0, 100],
            extrapolate: 'clamp',
        });

        return (
            <View style={{ width: 120, flexDirection: 'row' }}>
                <Animated.View style={{ flex: 1, transform: [{ translateX: trans }] }}>
                    <RectButton
                        style={styles.rightAction}
                        onPress={handleDelete}
                    >
                        <Ionicons name="trash" size={24} color="#fff" />
                        <Text style={styles.actionText}>Delete</Text>
                    </RectButton>
                </Animated.View>
            </View>
        );
    };

    return (
        <Swipeable
            ref={swipeableRef}
            enabled={enabled}
            renderRightActions={renderRightActions}
            onSwipeableOpen={(direction) => {
                if (direction === 'right') {
                    handleDelete();
                }
            }}
        >
            {children}
        </Swipeable>
    );
}

const styles = StyleSheet.create({
    rightAction: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        backgroundColor: '#ff3b30',
    },
    actionText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
        padding: 4,
    },
});
