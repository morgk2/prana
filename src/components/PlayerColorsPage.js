import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function PlayerColorsPage({ route, navigation }) {
    const { theme, playerColorMode, setPlayerColorMode } = route.params;

    const colorOptions = [
        { id: 'dark', label: 'Dark', description: 'Black player background' },
        { id: 'light', label: 'Light', description: 'White player background' },
    ];

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
                    <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
                </Pressable>
                <Text style={[styles.title, { color: theme.primaryText }]}>Player Colors</Text>
            </View>

            <ScrollView style={{ flex: 1 }}>
                <View style={styles.section}>
                    <Text style={[styles.sectionHeader, { color: theme.primaryText, marginBottom: 20 }]}>
                        Background Color
                    </Text>

                    {colorOptions.map((option, index) => (
                        <Pressable
                            key={option.id}
                            style={[
                                styles.row,
                                {
                                    backgroundColor: theme.card,
                                    borderBottomColor: theme.border,
                                    borderBottomWidth: index < colorOptions.length - 1 ? StyleSheet.hairlineWidth : 0
                                }
                            ]}
                            onPress={() => setPlayerColorMode(option.id)}
                        >
                            <View style={styles.rowLeft}>
                                <Text style={[styles.rowText, { color: theme.primaryText }]}>{option.label}</Text>
                                <Text style={[styles.rowDescription, { color: theme.secondaryText }]}>
                                    {option.description}
                                </Text>
                            </View>
                            {playerColorMode === option.id && (
                                <Ionicons name="checkmark" size={24} color={theme.accent} />
                            )}
                        </Pressable>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        paddingTop: 60,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backButtonContainer: {
        marginRight: 12,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
    },
    section: {
        marginTop: 20,
        paddingHorizontal: 16,
    },
    sectionHeader: {
        fontSize: 20,
        fontWeight: '700',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 10,
        marginBottom: 8,
    },
    rowLeft: {
        flex: 1,
    },
    rowText: {
        fontSize: 17,
        fontWeight: '500',
        marginBottom: 4,
    },
    rowDescription: {
        fontSize: 13,
    },
});
