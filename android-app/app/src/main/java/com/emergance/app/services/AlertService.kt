package com.emergance.app.services

import android.content.Context
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import com.emergance.app.R

class AlertService(private val context: Context) {
    fun playSosConfirmation() {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = (max * 0.9f).toInt().coerceAtLeast(1)
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)

        val played = runCatching {
            MediaPlayer.create(context, R.raw.sos_alert).apply {
                setOnCompletionListener { release() }
                setOnErrorListener { mp, _, _ ->
                    mp.release()
                    false
                }
                start()
            }
        }.isSuccess

        if (!played) {
            ToneGenerator(AudioManager.STREAM_ALARM, 100).startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 800)
        }
    }
}