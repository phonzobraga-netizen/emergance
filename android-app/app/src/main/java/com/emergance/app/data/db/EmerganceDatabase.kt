package com.emergance.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        IncidentEntity::class,
        MessageOutboxEntity::class,
        MessageInboxEntity::class,
        PeerEntity::class,
        DriverStateEntity::class
    ],
    version = 1,
    exportSchema = true
)
abstract class EmerganceDatabase : RoomDatabase() {
    abstract fun incidentDao(): IncidentDao
    abstract fun outboxDao(): OutboxDao
    abstract fun inboxDao(): InboxDao
    abstract fun peerDao(): PeerDao
    abstract fun driverStateDao(): DriverStateDao

    companion object {
        fun build(context: Context): EmerganceDatabase {
            return Room.databaseBuilder(
                context,
                EmerganceDatabase::class.java,
                "emergance-local.db"
            ).setJournalMode(JournalMode.WRITE_AHEAD_LOGGING).build()
        }
    }
}