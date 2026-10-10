# 預期：錯誤，模擬器沒有鏡頭
import cv2
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.streamon()
frame = tello.get_frame_read().frame
